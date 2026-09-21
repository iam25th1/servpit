// The pit, playing itself.
//
// One process, one writer. It plans and settles a round every interval using
// the same planRound and runRound the lever route uses, publishes where it is
// as it goes, and rests until the next one. Nothing it does is new game
// logic: it is scripts/round.ts on a clock, with its phases written down.
//
//   SERVPIT_ARENA_MODE=true npm run arena
//
// It refuses to start when another worker holds the lock, it never lets a
// failed round stop the loop, and it can be paused by creating the pause file
// in the data directory while it runs.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { PAUSE_FILE, arenaMode, roundIntervalSeconds } from "../src/config/arena";
import { toChips, weiPerChip } from "../src/config/stake";
import { ticksToMs } from "../src/config/playback";
import { getServerContext } from "../src/server/context";
import { readEnv } from "../src/server/env";
import { log } from "../src/server/log";
import { basescanTx } from "../src/server/money";
import { planRound, runRound, type RoundPlan } from "../src/server/round/flow";
import { ArenaStore, arenaFile, type ArenaPhase, type ArenaRound, type ArenaState, type PhaseMark } from "../src/server/arena/state";
import { ArenaAlreadyRunning, arenaLockFile, holdArenaLock } from "../src/server/arena/lock";
import { loadLocalEnv } from "./lib/loadEnv";
import { requireDeclaredBackend } from "./lib/requireBackend";

const envFile = loadLocalEnv();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

async function main(): Promise<void> {
  const env = readEnv();
  requireDeclaredBackend(env, envFile);
  if (!arenaMode()) {
    console.log("SERVPIT_ARENA_MODE is not true, so there is nothing for the worker to do. The lever starts rounds.");
    return;
  }

  const intervalMs = roundIntervalSeconds() * 1_000;
  const ctx = await getServerContext();
  const store = new ArenaStore(arenaFile(env.dataDir, ctx.chain.network), ctx.chain.network);
  const pauseFile = join(env.dataDir, PAUSE_FILE);

  let lock;
  try {
    lock = holdArenaLock(arenaLockFile(env.dataDir, ctx.chain.network));
  } catch (e) {
    if (e instanceof ArenaAlreadyRunning) {
      console.error(e.message);
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  let running = true;
  const stop = (signal: string) => () => {
    log.info("arena worker stopping", { signal });
    running = false;
  };
  process.once("SIGINT", stop("SIGINT"));
  process.once("SIGTERM", stop("SIGTERM"));

  console.log(`arena worker on ${ctx.chain.kind} (${ctx.chain.network}), a round every ${roundIntervalSeconds()} s`);
  console.log(`pause with: touch ${pauseFile}`);

  const maxRounds = Number.parseInt(process.env.SERVPIT_ARENA_MAX_ROUNDS ?? "0", 10);
  let played = 0;

  while (running) {
    const startedAt = Date.now();
    lock.beat();
    try {
      if (existsSync(pauseFile)) {
        rest(store, "Paused by the operator.", true, startedAt + intervalMs);
        log.info("arena paused", { pauseFile });
      } else {
        await playRound(ctx, store, startedAt + intervalMs);
        played += 1;
      }
    } catch (e) {
      // Nothing that happens inside a round may stop the loop. The reason is
      // recorded and the next interval comes round as usual.
      const reason = e instanceof Error ? e.message : String(e);
      failed(store, reason, startedAt + intervalMs);
      log.error("arena round failed", { reason });
    }

    if (maxRounds > 0 && played >= maxRounds) break;
    const waitMs = startedAt + intervalMs - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    if (!running) break;
  }

  lock.release();
  console.log("arena worker stopped");
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
async function playRound(ctx: Awaited<ReturnType<typeof getServerContext>>, store: ArenaStore, nextAt: number): Promise<void> {
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
    return;
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
  await sleep(durationMs);

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
}

/** Entrant id to display name, for the fight's own nameplates. */
function entrantNamesOf(plan: RoundPlan): Record<string, string> {
  const names: Record<string, string> = {};
  for (const e of plan.entering) {
    names[e.entrantId] = plan.decisions.find((d) => d.agentId === e.agentId)?.name ?? e.agentId;
  }
  return names;
}

main().catch((e) => {
  log.error("arena worker stopped on an error", { error: e instanceof Error ? e.message : String(e) });
  process.exitCode = 1;
});
