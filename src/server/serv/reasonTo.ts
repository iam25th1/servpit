// Reasoning rounds on purpose, up to a count, at a price stated up front.
//
// The pit already has every piece: scheduled rounds reason while the
// scheduled switch is on, the worker refuses to reason past the daily budget,
// and every round records what its own calls cost. This is the arithmetic a
// terminal needs to use those pieces deliberately: how many rounds have
// reasoned so far, counted exactly as npm run stats counts them, what one has
// cost when it did, and when to stop.
//
// Arithmetic only. Nothing here reaches a network, a wallet or a model, and
// nothing here writes a file; scripts/reason.ts does the switching.

import { MICRO_CENTS_PER_CENT } from "@/server/pulls/budget";
import { classSplit, lifetimeRounds } from "@/server/stats/history";
import type { Stores } from "@/server/stats/read";

/** Micro cents in a dollar. */
export const MICRO_CENTS_PER_DOLLAR = MICRO_CENTS_PER_CENT * 100;

/** Rounds in a row that may come back unreasoned before a run gives up. */
export const UNREASONED_IN_A_ROW_LIMIT = 3;

/** Rounds that have reasoned, by the same rule and from the same stores as npm run stats. */
export function reasonedSoFar(stores: Stores): number {
  return classSplit(lifetimeRounds(stores)).reasoned;
}

export interface Rate {
  /** What one reasoned round has cost, on average, in micro cents. */
  perRoundMicroCents: number;
  /** How many reasoned rounds that average is over. */
  rounds: number;
  calls: number;
}

/**
 * What a reasoned round has cost, measured from the rounds that reasoned and
 * recorded their own spend.
 *
 * Only a round's own figure counts. Rounds stored before cost was per round
 * carry the process's running total instead, which a round store row gives
 * away by having no token counts; those are left out, because averaging a
 * running total would price a round at a day's spend. Null when nothing on
 * file has a figure of its own, which is an honest "not measured" rather than
 * a guess.
 */
export function measuredRate(stores: Stores): Rate | null {
  const seen = new Map<string, { micro: number; calls: number }>();
  for (const round of stores.rounds ?? []) {
    const reasoned = (round.agents ?? []).some((a) => a.source === "serv");
    const own = round.servTokensIn !== undefined && round.servTokensIn !== null;
    if (!reasoned || !own || !(typeof round.servMicroCents === "number" && round.servMicroCents > 0)) continue;
    seen.set(round.roundId, { micro: round.servMicroCents, calls: round.servCalls ?? 0 });
  }
  for (const line of stores.summaries ?? []) {
    if (line.k !== "round" || typeof line.roundId !== "string" || seen.has(line.roundId)) continue;
    if (line.answers !== "reasoned" || line.backfilled === true) continue;
    const micro = line.servMicroCents;
    if (typeof micro !== "number" || !(micro > 0)) continue;
    seen.set(line.roundId, { micro, calls: typeof line.servCalls === "number" ? line.servCalls : 0 });
  }
  if (seen.size === 0) return null;
  let micro = 0;
  let calls = 0;
  for (const row of seen.values()) {
    micro += row.micro;
    calls += row.calls;
  }
  return { perRoundMicroCents: Math.round(micro / seen.size), rounds: seen.size, calls };
}

/** Dollars, to the hundredth of a cent, which is as fine as these costs get. */
export function dollars(microCents: number): string {
  return `$${(microCents / MICRO_CENTS_PER_DOLLAR).toFixed(4)}`;
}

/** A dollar figure from the command line, as micro cents, or a RangeError. */
export function microCentsFromDollars(raw: string): number {
  const value = Number(raw.replace(/^\$/, ""));
  if (!Number.isFinite(value) || value <= 0 || value > 100) throw new RangeError(`expected a dollar amount above 0 and at most 100, got ${raw}`);
  return Math.round(value * MICRO_CENTS_PER_DOLLAR);
}

export interface Plan {
  target: number;
  have: number;
  need: number;
  /** Per reasoned round, in micro cents, or null when there is nothing to price it by. */
  perRoundMicroCents: number | null;
  estimateMicroCents: number | null;
  /** The run stops once its measured spend reaches this. Null when nothing prices it. */
  capMicroCents: number | null;
  /** Rounds the rest of today's budget covers at that rate, or null when unpriced. */
  budgetCovers: number | null;
}

/**
 * How many rounds a run needs and what they should cost.
 *
 * The cap is twice the estimate unless one was given: a round can cost more
 * than the average when the Shadow Agent sends a draft back, and a run should
 * have room for that without having room for a runaway.
 */
export function planRun(input: { target: number; have: number; perRoundMicroCents: number | null; capMicroCents?: number | null; budgetLeftMicroCents: number }): Plan {
  const need = Math.max(0, input.target - input.have);
  const per = input.perRoundMicroCents;
  const estimate = per === null ? null : per * need;
  const cap = input.capMicroCents ?? (estimate === null ? null : Math.max(estimate * 2, per ?? 0));
  const budgetCovers = per === null || per <= 0 ? null : Math.floor(Math.max(0, input.budgetLeftMicroCents) / per);
  return { target: input.target, have: input.have, need, perRoundMicroCents: per, estimateMicroCents: estimate, capMicroCents: cap, budgetCovers };
}

export interface RoundSeen {
  roundId: string;
  reasoned: boolean;
  calls: number;
  microCents: number;
}

/**
 * The rounds in the round store that settled after a run began, oldest
 * first, and not yet reported.
 */
export function newRounds(stores: Stores, since: number, reported: ReadonlySet<string>): RoundSeen[] {
  const rows = (stores.rounds ?? [])
    .filter((r) => !reported.has(r.roundId))
    .filter((r) => {
      const at = Date.parse(r.createdAt ?? "");
      return Number.isFinite(at) && at >= since;
    })
    .sort((a, b) => Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? ""));
  return rows.map((r) => ({
    roundId: r.roundId,
    reasoned: (r.agents ?? []).some((a) => a.source === "serv"),
    calls: r.servCalls ?? 0,
    microCents: typeof r.servMicroCents === "number" && r.servTokensIn !== undefined ? r.servMicroCents : 0,
  }));
}

export type Stop = { stop: false } | { stop: true; why: "target" | "cap" | "unreasoned" };

/** Whether a run is done, after the rounds it has seen so far. */
export function shouldStop(state: { reasoned: number; need: number; spentMicroCents: number; capMicroCents: number | null; unreasonedInARow: number }): Stop {
  if (state.reasoned >= state.need) return { stop: true, why: "target" };
  if (state.capMicroCents !== null && state.spentMicroCents >= state.capMicroCents) return { stop: true, why: "cap" };
  if (state.unreasonedInARow >= UNREASONED_IN_A_ROW_LIMIT) return { stop: true, why: "unreasoned" };
  return { stop: false };
}
