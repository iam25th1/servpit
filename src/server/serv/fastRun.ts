// A catch up run: rounds back to back, with nobody watching.
//
// The pit plays one round an interval because an interval is what a spectator
// needs: six seconds on the draw, the backing window, the fight at the speed
// it happened, a moment on the figures. Eighty eight rounds at that pace is
// four and a half hours. With nobody watching, the only thing a round needs is
// the round: the same planRound, the same runRound, the same settle lock, the
// same stores and the same permanent line. So a fast run plays them itself,
// one after another, with the show turned off.
//
// One at a time, and that is not a performance choice. Six agent wallets send
// entries under their own nonces and the settle lock guards one round at a
// time; two rounds in flight would have two settles racing for the same
// nonces, and a nonce used twice is a transfer that either replaces another or
// pays twice. The lock would serialise the settles and would not serialise the
// reads of each wallet's next nonce, which is where the damage would be. So
// this stays sequential, and says so when the projection is long.
//
// Arithmetic and sequencing only. Nothing here opens a wallet, calls a model
// or writes a store: the injected play function does that, by the ordinary
// path.

import { MICRO_CENTS_PER_CENT } from "@/server/pulls/budget";
import { shouldStop } from "./reasonTo";

/** What the whole run is meant to fit inside. */
export const TIME_BUDGET_MS = 30 * 60_000;

/** Rounds to play before the pace is worth projecting from. */
export const MEASURE_AFTER = 2;

/** Seconds a round took, averaged, or null before anything has been played. */
export function secondsPerRound(rounds: number, elapsedMs: number): number | null {
  if (rounds <= 0) return null;
  return elapsedMs / rounds / 1_000;
}

/** How long the rounds still to play should take, at the pace measured so far. */
export function projectMs(rounds: number, elapsedMs: number, remaining: number): number | null {
  const per = secondsPerRound(rounds, elapsedMs);
  if (per === null) return null;
  return Math.round(per * 1_000 * Math.max(0, remaining));
}

/** A length of time as a person would say it. */
export function saidAs(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 1) return `${Math.round(ms / 1_000)} s`;
  if (minutes < 90) return `${minutes.toFixed(1)} min`;
  return `${(minutes / 60).toFixed(1)} hours`;
}

/** The most the budget may be set to, as the settings file will accept it. */
export const MAX_BUDGET_CENTS = 100_000;

/**
 * What the daily budget has to be for this run not to be gated by it.
 *
 * The worker stops reasoning once the day's recorded spend reaches the
 * budget, so the budget has to cover what is already spent today plus what
 * this run may spend, which is its cap. A cent of headroom, because the gate
 * is on reaching the figure rather than passing it. Never lowered: a budget
 * already higher than that is left alone.
 */
export function budgetCentsFor(input: { spentTodayMicroCents: number; capMicroCents: number; currentCents: number }): number {
  const needed = Math.ceil((Math.max(0, input.spentTodayMicroCents) + Math.max(0, input.capMicroCents)) / MICRO_CENTS_PER_CENT) + 1;
  return Math.min(MAX_BUDGET_CENTS, Math.max(needed, input.currentCents));
}

/** One thing to put back, and how. */
interface Undo {
  name: string;
  run: () => void;
}

/**
 * Everything this run changed, and how to change it back.
 *
 * Newest first, and a failure in one does not stop the others: the whole
 * point is that a crash leaves the pit as it was found, and a budget left
 * raised because a switch file would not delete is the kind of thing that is
 * noticed a week later.
 */
export class Restorer {
  private readonly undos: Undo[] = [];
  private done = false;

  add(name: string, run: () => void): void {
    this.undos.push({ name, run });
  }

  /** Whether anything is still waiting to be put back. */
  get pending(): number {
    return this.done ? 0 : this.undos.length;
  }

  /** Puts everything back, once, and says what happened to each. */
  restore(): Array<{ name: string; error: string | null }> {
    if (this.done) return [];
    this.done = true;
    const out: Array<{ name: string; error: string | null }> = [];
    for (const undo of [...this.undos].reverse()) {
      try {
        undo.run();
        out.push({ name: undo.name, error: null });
      } catch (e) {
        out.push({ name: undo.name, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  }
}

/** What one round of a fast run did. */
export interface FastRow {
  roundId: string;
  reasoned: boolean;
  calls: number;
  microCents: number;
  /** Reasoned rounds this run has added so far, including this one. */
  reasonedSoFar: number;
  spentMicroCents: number;
  seconds: number;
}

export interface FastResult {
  played: number;
  reasoned: number;
  calls: number;
  spentMicroCents: number;
  elapsedMs: number;
  /** Why it ended: the target, the cap, three unreasoned rounds, the clock, or a signal. */
  why: "target" | "cap" | "unreasoned" | "time" | "stopped";
}

export interface FastDeps {
  /** Reasoned rounds this run has to add. */
  need: number;
  /** The run stops once the rounds it played have cost this much. */
  capMicroCents: number;
  /** Plays one round the ordinary way, minus the show, and answers its id. */
  play: () => Promise<string>;
  /** What the round store says about a settled round. Null when it is not there. */
  read: (roundId: string) => { reasoned: boolean; calls: number; microCents: number } | null;
  /** One line per round, for the terminal and the log. */
  onRound: (row: FastRow) => void;
  /**
   * Asked once, after the pace is measurable, when the projection is over the
   * time budget. False stops the run.
   */
  overTime?: (projectedMs: number, perRoundSeconds: number) => Promise<boolean>;
  /** False stops the run at the next round boundary, for a signal. */
  running?: () => boolean;
  now?: () => number;
  timeBudgetMs?: number;
}

/**
 * Plays rounds until the target, the cap, the stop rules or a signal.
 *
 * The count comes from what each round recorded rather than from what this
 * asked for: a round that was meant to reason and came back on instinct does
 * not count towards the target, and three of those in a row stop the run,
 * because something is wrong that another round will not fix.
 */
export async function runFast(deps: FastDeps): Promise<FastResult> {
  const now = deps.now ?? Date.now;
  const running = deps.running ?? (() => true);
  const timeBudgetMs = deps.timeBudgetMs ?? TIME_BUDGET_MS;
  const startedAt = now();

  let played = 0;
  let reasoned = 0;
  let calls = 0;
  let spent = 0;
  let unreasonedInARow = 0;
  let asked = false;
  let why: FastResult["why"] = "stopped";

  while (running()) {
    const verdict = shouldStop({ reasoned, need: deps.need, spentMicroCents: spent, capMicroCents: deps.capMicroCents, unreasonedInARow });
    if (verdict.stop) {
      why = verdict.why;
      break;
    }

    const roundStartedAt = now();
    const roundId = await deps.play();
    const seconds = (now() - roundStartedAt) / 1_000;
    played += 1;

    // What the round recorded, not what it was asked to do. A round whose row
    // cannot be read counts as unreasoned and costing nothing, which is the
    // safe direction: it moves the run towards stopping rather than towards
    // spending.
    const row = deps.read(roundId);
    const wasReasoned = row?.reasoned === true;
    calls += row?.calls ?? 0;
    spent += row?.microCents ?? 0;
    if (wasReasoned) {
      reasoned += 1;
      unreasonedInARow = 0;
    } else {
      unreasonedInARow += 1;
    }
    deps.onRound({ roundId, reasoned: wasReasoned, calls: row?.calls ?? 0, microCents: row?.microCents ?? 0, reasonedSoFar: reasoned, spentMicroCents: spent, seconds });

    // Once the pace is real, say how long the rest will take, and ask when it
    // is longer than the run was meant to be.
    if (!asked && played >= MEASURE_AFTER && deps.overTime !== undefined) {
      asked = true;
      const elapsed = now() - startedAt;
      const projected = projectMs(played, elapsed, Math.max(0, deps.need - reasoned));
      if (projected !== null && projected > timeBudgetMs) {
        const keepGoing = await deps.overTime(projected, secondsPerRound(played, elapsed) ?? 0);
        if (!keepGoing) {
          why = "time";
          break;
        }
      }
    }
  }

  if (why === "stopped" && !running()) why = "stopped";
  const after = shouldStop({ reasoned, need: deps.need, spentMicroCents: spent, capMicroCents: deps.capMicroCents, unreasonedInARow });
  if (why === "stopped" && after.stop) why = after.why;
  return { played, reasoned, calls, spentMicroCents: spent, elapsedMs: now() - startedAt, why };
}
