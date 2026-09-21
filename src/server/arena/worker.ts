// The loop, and one round of it.
//
// Here rather than in scripts/arena.ts so it can be driven by a test: the
// script is the entry point that reads the environment, takes the lock and
// handles signals, and everything that decides what the pit does is in this
// file.
//
// Nothing in here is new game logic. It calls the same planRound and runRound
// the lever route calls, and its own work is deciding when to play, when to
// rest and what to publish.

import { existsSync } from "node:fs";
import { toChips, weiPerChip } from "@/config/stake";
import { ticksToMs } from "@/config/playback";
import type { ServerContext } from "../context";
import { log } from "../log";
import { basescanTx } from "../money";
import { planRound, runRound, type RoundPlan } from "../round/flow";
import { ArenaStore, type ArenaPhase, type ArenaRound, type ArenaState, type PhaseMark } from "./state";

const sleepMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Whether an interval produced a round or a reason there was not one. */
export type ArenaOutcome = "played" | "rested";

export interface LoopOptions {
  ctx: ServerContext;
  store: ArenaStore;
  /** Its presence pauses the loop. Read once per interval. */
  pauseFile: string;
  intervalMs: number;
  /** Stop after this many rounds. Zero runs until something stops it. */
  maxRounds?: number;
  /** True while the loop should keep going. Set false by a signal. */
  running?: () => boolean;
  /** Called at the top of every interval, to say the worker is alive. */
  beat?: () => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Injected by tests. The real one is playArenaRound. */
  play?: (ctx: ServerContext, store: ArenaStore, nextAt: number) => Promise<ArenaOutcome | void>;
}

/**
 * Plays rounds until something stops it.
 *
 * Nothing a round does may stop the loop. A round that throws is recorded as
 * failed with its reason and the next interval comes round as usual, because
 * a pit that stops after one bad round is a pit that stops.
 */
export async function runArenaLoop(options: LoopOptions): Promise<{ played: number; failed: number; rested: number }> {
  const { ctx, store, pauseFile, intervalMs } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepMs;
  const running = options.running ?? (() => true);
  const play = options.play ?? playArenaRound;
  const maxRounds = options.maxRounds ?? 0;
  const counts = { played: 0, failed: 0, rested: 0 };

  while (running()) {
    const startedAt = now();
    const nextAt = startedAt + intervalMs;
    options.beat?.();
    try {
      if (existsSync(pauseFile)) {
        rest(store, "Paused by the operator.", true, nextAt);
        counts.rested += 1;
        log.info("arena paused", { pauseFile });
      } else {
        const funds = await fundsCheck(ctx);
        if (!funds.ok) {
          rest(store, funds.reason, false, nextAt);
          counts.rested += 1;
          log.warn("arena resting on funds", { reason: funds.reason });
        } else {
          // A round that rests because nobody could cover a seat is not a
          // round played, and counting it as one would make an empty pit look
          // busy in the only numbers an operator sees.
          const outcome = (await play(ctx, store, nextAt)) ?? "played";
          if (outcome === "rested") counts.rested += 1;
          else counts.played += 1;
        }
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      failed(store, reason, nextAt);
      counts.failed += 1;
      log.error("arena round failed", { reason });
    }

    if (maxRounds > 0 && counts.played + counts.failed + counts.rested >= maxRounds) break;
    const waitMs = nextAt - now();
    if (waitMs > 0) await sleep(waitMs);
    if (!running()) break;
  }
  return counts;
}

/**
 * Whether a round could do anything except fail on money.
 *
 * Two things are checked, both about the pot, because the pot is the only
 * wallet whose emptiness fails a round rather than degrading it. A bank with
 * nothing in it lends nothing and the round plays; an operator with nothing
 * leaves a wrecked seat empty and the round plays. A pot that cannot pay
 * cannot finish: entries are collected and then the payout throws, which is
 * the one shape where agents have paid for a round nobody can settle.
 *
 * The bank's balance is read as well, and reported, so an operator watching
 * the log can see the treasury drain before anybody asks them about it.
 */
export async function fundsCheck(ctx: ServerContext): Promise<{ ok: true } | { ok: false; reason: string }> {
  const potWei = await ctx.bankroll.get(ctx.wallets.pot);
  const reserveWei = ctx.chain.gasReserveWei;
  const carriedWei = ctx.flow.rollover.carriedWei;
  if (ctx.wallets.bank) {
    log.info("arena treasury", { bankChips: toChips(await ctx.bankroll.get(ctx.wallets.bank)), potChips: toChips(potWei) });
  }
  if (potWei <= reserveWei) {
    return { ok: false, reason: "The pot has nothing spare for the fees a payout costs, so a winner could not be paid." };
  }
  if (potWei < carriedWei + reserveWei) {
    return { ok: false, reason: "The pot is holding less than the prize it carries, so a win could not be paid out." };
  }
  return { ok: true };
}

/** The pit is idle, and the reason is a sentence rather than a state. */
function rest(store: ArenaStore, reason: string, paused: boolean, nextAt: number): void {
  const now = new Date().toISOString();
  const current = store.read();
  const round = current.round ? { ...current.round, phase: "resting" as ArenaPhase, phases: [...current.round.phases, { phase: "resting" as ArenaPhase, at: now, reason }] } : null;
  store.write({ round, last: current.last, paused, nextRoundAt: new Date(nextAt).toISOString() });
}

function failed(store: ArenaStore, reason: string, nextAt: number): void {
  const now = new Date().toISOString();
  const current = store.read();
  const round = current.round ? { ...current.round, phase: "failed" as ArenaPhase, phases: [...current.round.phases, { phase: "failed" as ArenaPhase, at: now, reason }] } : null;
  store.write({ round, last: current.last, paused: current.paused, nextRoundAt: new Date(nextAt).toISOString() });
}

/**
 * One round, start to finish, with every phase published as it begins.
 *
 * The outcome is computed by runRound and is not published until the fight
 * phase starts: the seed, the log and the placements all decide the winner,
 * and the resolver is deterministic.
 */
export async function playArenaRound(ctx: ServerContext, store: ArenaStore, nextAt: number): Promise<ArenaOutcome> {
  const flow = ctx.flow;
  const seed = `arena-${Date.now().toString(36)}`;
  const link = (hash: string | null | undefined): string | null => (ctx.chain.settles && hash ? basescanTx(ctx.chain.network, hash) : null);

  let round: ArenaRound = {
    roundId: "",
    startedAt: new Date().toISOString(),
    phase: "planning",
    phases: [{ phase: "planning", at: new Date().toISOString() }],
    network: ctx.chain.network,
    backend: ctx.chain.kind,
    entrants: flow.entrants,
    bots: 0,
    stakeChips: 0,
    weiPerChip: weiPerChip().toString(),
    decisions: [],
    loans: [],
    refusals: [],
    bank: null,
    entries: [],
  };
  const publish = (next: Partial<ArenaRound>, phase?: ArenaPhase, mark?: Omit<PhaseMark, "phase" | "at">): void => {
    round = { ...round, ...next };
    if (phase && phase !== round.phase) {
      round = { ...round, phase, phases: [...round.phases, { phase, at: new Date().toISOString(), ...mark }] };
    }
    const current: ArenaState = store.read();
    store.write({ round, last: current.last, paused: current.paused, nextRoundAt: new Date(nextAt).toISOString() });
  };

  const plan = await planRound(
    flow,
    seed,
    (d) => {
      publish(
        {
          decisions: [
            ...round.decisions.filter((existing) => existing.agentId !== d.agentId),
            {
              agentId: d.agentId,
              name: d.name,
              face: d.face ?? null,
              enter: d.decision.enter,
              stake: d.decision.stake,
              reason: d.decision.reason,
              source: d.source,
              balance: toChips(d.balanceWei),
              debt: toChips(d.debtWei ?? 0n),
            },
          ],
        },
        "deciding",
      );
    },
    (answer, name) => {
      const entry = { agentId: answer.agentId, name, asked: 0, reason: answer.decision.reason, source: answer.source };
      publish(
        answer.decision.approve
          ? { loans: [...round.loans, { ...entry, amount: answer.decision.amountChips, rateBps: answer.decision.rateBps }] }
          : { refusals: [...round.refusals, entry] },
        "banking",
      );
    },
  );

  publish(
    {
      roundId: plan.roundId,
      bots: plan.bots.length,
      stakeChips: toChips(plan.stakeWei),
      // From the plan, which is what actually settles, rather than from the
      // stream above: a late line must not leave a row the round did not use.
      decisions: plan.decisions.map((d) => ({
        agentId: d.agentId,
        name: d.name,
        face: d.face ?? null,
        enter: d.decision.enter,
        stake: d.decision.stake,
        reason: d.decision.reason,
        source: d.source,
        balance: toChips(d.balanceWei),
        debt: toChips(d.debtWei ?? 0n),
      })),
      loans: plan.loans.map((l) => ({ agentId: l.agentId, name: l.name, asked: toChips(l.askedWei), amount: toChips(l.principalWei), rateBps: l.rateBps, reason: l.reason, source: l.source })),
      refusals: plan.refusals.map((r) => ({ agentId: r.agentId, name: r.name, asked: toChips(r.askedWei), reason: r.reason, source: "serv" })),
      bank: plan.bank ? { treasury: toChips(plan.bank.treasuryWei), book: plan.bank.book.map((b) => ({ agentId: b.agentId, name: b.name, owed: toChips(b.principalWei + b.interestWei), principal: toChips(b.principalWei), rateBps: b.rateBps })) } : null,
    },
    "settling",
  );

  if (plan.entering.length === 0) {
    // Nobody is in, so there is nothing to settle and nothing to watch. The
    // round is not a failure: it is an empty pit, and it says so.
    publish({}, "resting", { reason: "Nobody could cover a seat this round." });
    const current = store.read();
    store.write({ round, last: current.last, paused: current.paused, nextRoundAt: new Date(nextAt).toISOString() });
    log.info("arena rested, nobody entered", { roundId: plan.roundId });
    return "rested";
  }

  const run = await runRound(flow, plan, {
    onEntry: (agentId, outcome) => {
      publish({ entries: [...round.entries, { agentId, amountWei: outcome.amountWei.toString(), txHash: outcome.txHash ?? null, link: outcome.link }] });
    },
  });

  // Settled. The fight can be shown now, and only now: everything in here
  // decides the winner, and the resolver is deterministic.
  // Whole milliseconds: this is published as the length of a moment every
  // viewer is meant to share, and a fraction of one helps nobody.
  const durationMs = Math.round(ticksToMs(Math.max(...run.round.log.map((e) => e.t), 0)));
  publish(
    {
      fight: {
        seed: plan.seed,
        durationMs,
        characters: run.round.characters,
        log: run.round.log,
        placements: run.round.placements,
        names: entrantNamesOf(plan),
      },
    },
    "fight",
    { durationMs },
  );
  await sleepMs(durationMs);

  publish(
    {
      result: {
        winner: run.round.placements[0],
        potWei: run.prize.poolWei.toString(),
        rakeWei: run.prize.rakeWei.toString(),
        payoutWei: run.prize.payoutWei.toString(),
        rolloverInWei: run.rolloverInWei.toString(),
        nextRolloverWei: run.prize.nextRolloverWei.toString(),
        reconciled: run.reconciliation.ok,
        transfers: [
          ...run.loans.map((l) => ({ kind: l.kind, agentId: l.agentId, amountWei: l.amountWei.toString(), txHash: l.txHash ?? null, link: link(l.txHash) })),
          ...run.entries.map((e) => ({ kind: e.kind, agentId: e.agentId, amountWei: e.amountWei.toString(), txHash: e.txHash ?? null, link: link(e.txHash) })),
          ...(run.payout ? [{ kind: run.payout.kind, agentId: run.payout.agentId, amountWei: run.payout.amountWei.toString(), txHash: run.payout.txHash ?? null, link: link(run.payout.txHash) }] : []),
          ...run.seizures.map((s) => ({ kind: s.kind, agentId: s.agentId, amountWei: s.amountWei.toString(), txHash: s.txHash ?? null, link: link(s.txHash) })),
          ...run.replacements.filter((r) => r.outcome).map((r) => ({ kind: "refill", agentId: r.walletId, amountWei: r.fundedWei.toString(), txHash: r.outcome!.txHash ?? null, link: link(r.outcome!.txHash) })),
        ],
        repayment: run.repayment
          ? {
              agentId: run.repayment.agentId,
              name: plan.decisions.find((d) => d.agentId === run.repayment!.agentId)?.name ?? run.repayment.agentId,
              interestWei: run.repayment.interestWei.toString(),
              principalWei: run.repayment.principalWei.toString(),
              paidWei: run.repayment.outcome.amountWei.toString(),
              link: link(run.repayment.outcome.txHash),
            }
          : null,
        wrecks: run.wrecks,
        replacements: run.replacements.map((r) => ({ walletId: r.walletId, name: r.name, face: r.face, fundedWei: r.fundedWei.toString(), link: link(r.outcome?.txHash) })),
        interest: run.interest.map((i) => ({ agentId: i.agentId, chargedWei: i.chargedWei.toString(), rateBps: i.rateBps })),
        servCalls: plan.servCalls,
        costSummary: flow.meter.summary(),
      },
    },
    "result",
  );

  const settled = store.read();
  store.write({ round, last: round, paused: settled.paused, nextRoundAt: new Date(nextAt).toISOString() });
  log.info("arena round complete", { roundId: plan.roundId, winner: run.round.placements[0], reconciled: run.reconciliation.ok, durationMs });
  return "played";
}

/** Entrant id to display name, for the fight's own nameplates. */
function entrantNamesOf(plan: RoundPlan): Record<string, string> {
  const names: Record<string, string> = {};
  for (const e of plan.entering) {
    names[e.entrantId] = plan.decisions.find((d) => d.agentId === e.agentId)?.name ?? e.agentId;
  }
  return names;
}

