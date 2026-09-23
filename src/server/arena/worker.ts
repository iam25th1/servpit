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
import { backingWindowSeconds } from "@/config/backing";
import { PULL_POLL_MS } from "@/config/pulls";
import { toChips, weiPerChip } from "@/config/stake";
import { ticksToMs } from "@/config/playback";
import type { ServerContext } from "../context";
import { log } from "../log";
import { basescanTx } from "../money";
import { planRound, runRound, type RoundPlan } from "../round/flow";
import { scheduledReasoningOn, servReasoningOn } from "../serv/switch";
import { budgetState } from "../pulls/budget";
import { readPullSettings } from "../pulls/settings";
import { settleBackingQuietly } from "../backing/settle";
import { ArenaStore, type ArenaPhase, type ArenaRound, type ArenaState, type PhaseMark } from "./state";

const sleepMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * How long the draw is on screen before the fight starts.
 *
 * The lever takes about a second to pull and release, the reels spin and stop
 * one at a time, and the payoff lands on the last one. Six seconds covers all
 * of that with room to read it, and it is fixed rather than measured so every
 * viewer's reveal ends at the same moment the fight begins.
 */
export const REEL_REVEAL_MS = 6_000;

/**
 * How long the result stands before the pit is simply waiting.
 *
 * The figures are a moment, not a state: without this the last round's result
 * is what a viewer stares at for the rest of the interval, and the pit never
 * looks like it is between rounds. Capped by whatever is left of the interval,
 * so a short interval skips the dwell rather than overrunning.
 */
export const RESULT_DWELL_MS = 12_000;

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
  play?: (ctx: ServerContext, store: ArenaStore, nextAt: number, pulledBy?: string | null) => Promise<ArenaOutcome | void>;
  /** The queue of asks from the site, when the pit takes them. */
  pulls?: PullSource;
}

/**
 * What the loop needs from the pull log.
 *
 * An interface rather than the store itself, so the loop can be driven by a
 * test without a file, and so nothing in here can write a line the log did
 * not mean to offer.
 */
export interface PullSource {
  pending(): { id: string; handle: string } | null;
  take(id: string): void;
  start(id: string, roundId: string): void;
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
        clearPause(store);
        const funds = await fundsCheck(ctx);
        if (!funds.ok) {
          rest(store, funds.reason, false, nextAt);
          counts.rested += 1;
          log.warn("arena resting on funds", { reason: funds.reason });
        } else {
          // Somebody asking for this round, if anybody did. Taken before the
          // round starts so a second ask cannot queue behind it while the
          // plan is being built, and named on the round itself.
          const asked = options.pulls?.pending() ?? null;
          if (asked) {
            options.pulls?.take(asked.id);
            log.info("arena round pulled", { handle: asked.handle });
          }
          // A round that rests because nobody could cover a seat is not a
          // round played, and counting it as one would make an empty pit look
          // busy in the only numbers an operator sees.
          const outcome = (await play(ctx, store, nextAt, asked?.handle ?? null)) ?? "played";
          if (asked) {
            const roundId = store.read().round?.roundId;
            if (roundId) options.pulls?.start(asked.id, roundId);
          }
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
    // The wait is in slices rather than one sleep, because somebody at a
    // screen may ask for a round in the middle of it and an hour is a long
    // time to hold a lever down. Nothing else changes: an ask that arrives
    // ends the wait early, and the next interval is measured from the round
    // it started, exactly as a scheduled one is.
    let waitMs = nextAt - now();
    while (waitMs > 0 && running()) {
      if (options.pulls?.pending()) break;
      const slice = Math.min(waitMs, PULL_POLL_MS);
      await sleep(slice);
      waitMs = nextAt - now();
    }
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

/**
 * The pit records that it is running again the moment it runs.
 *
 * The pause goes into the state once, on the rest that stopped the pit, and
 * every write after that carries the state forward. Without this, a resumed
 * pit played rounds under a state that still read paused, and everything that
 * reads the state believed it: the health line, and the badge a viewer sees.
 */
function clearPause(store: ArenaStore): void {
  const current = store.read();
  if (!current.paused) return;
  store.write({ round: current.round, last: current.last, paused: false, nextRoundAt: current.nextRoundAt });
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
 * Whether a round reasons, which is also what the round publishes about
 * itself.
 *
 * Three gates and every one of them can say no. What the round is for: a
 * pull asks to reason and a scheduled round does not unless an operator has
 * said it should. What the day has left, because reasoning is the only thing
 * here that costs per round. And the operator switch, which is the master.
 *
 * planRound checks the switch again on its own, which is deliberate: this is
 * what the round says about itself and that is what actually reaches a model.
 * A published flag that said a round was reasoning while the switch was off
 * would be a claim nobody could check from the outside.
 */
export function roundReasons(gates: { pulled: boolean; scheduledReasoning: boolean; withinBudget: boolean; switchOn: boolean; keyed?: boolean }): boolean {
  // No key, no reasoning, whatever anybody has switched on.
  if (gates.keyed === false) return false;
  if (!gates.switchOn) return false;
  if (!gates.withinBudget) return false;
  return gates.pulled || gates.scheduledReasoning;
}

/**
 * One round, start to finish, with every phase published as it begins.
 *
 * The outcome is computed by runRound and is not published until the fight
 * phase starts: the seed, the log and the placements all decide the winner,
 * and the resolver is deterministic.
 */
export async function playArenaRound(ctx: ServerContext, store: ArenaStore, nextAt: number, pulledBy: string | null = null): Promise<ArenaOutcome> {
  const flow = ctx.flow;
  const seed = `arena-${Date.now().toString(36)}`;
  // A round somebody asked for reasons. A round the clock asked for does not,
  // unless an operator has said it should: the pit plays itself all day, and
  // a day of reasoning is a day of credit nobody was there to read. Either
  // way the operator switch is still the master, inside planRound.
  //
  // The daily budget is enforced here rather than at the button, because the
  // button is advice and this is the only writer. Over budget, the round
  // still plays: it just plays on instinct, which costs nothing.
  const budget = budgetState(flow.store.all(), readPullSettings(flow.pullSettingsFile ?? "").dailyBudgetCents, Date.now());
  const reasoning = roundReasons({
    pulled: pulledBy !== null,
    scheduledReasoning: scheduledReasoningOn(flow.servScheduledFile),
    withinBudget: budget.withinBudget,
    switchOn: servReasoningOn(flow.servSwitchFile),
    keyed: Boolean(flow.serv),
  });
  if (pulledBy !== null && !reasoning) {
    log.info("arena round on instinct", { spentMicroCents: budget.spentMicroCents, budgetMicroCents: budget.budgetMicroCents, switchOn: servReasoningOn(flow.servSwitchFile) });
  }
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
    pulledBy,
    reasoning,
  };
  const publish = (next: Partial<ArenaRound>, phase?: ArenaPhase, mark?: Omit<PhaseMark, "phase" | "at">): void => {
    round = { ...round, ...next };
    if (phase && phase !== round.phase) {
      round = { ...round, phase, phases: [...round.phases, { phase, at: new Date().toISOString(), ...mark }] };
    }
    const current: ArenaState = store.read();
    store.write({ round, last: current.last, paused: current.paused, nextRoundAt: new Date(nextAt).toISOString() });
  };

  // Published before anything is read from the chain, so a viewer joining
  // during the ten seconds of balance reads sees a round starting rather than
  // the last one's result. Without it nothing reached the file until the
  // first agent answered.
  publish({});

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
              ...(d.evidence ? { evidence: { matches: d.evidence.matches, entered: d.evidence.entered, typicalStake: d.evidence.typicalStake } } : {}),
            },
          ],
        },
        "deciding",
      );
    },
    (answer, name, bank) => {
      const entry = {
        agentId: answer.agentId,
        name,
        asked: 0,
        reason: answer.decision.reason,
        source: answer.source,
        ...(answer.evidence ? { evidence: { matches: answer.evidence.matches, approved: answer.evidence.approved, typicalAmount: answer.evidence.typicalAmount } } : {}),
      };
      // The lender itself, alongside its answer. Until this the banking phase
      // published the answers and nothing that draws them, so a viewer
      // watching a round where everybody had to borrow saw the tapped out
      // lineup and no Marrow at all.
      const book = { treasury: toChips(bank.treasuryWei), book: bank.book.map((b) => ({ agentId: b.agentId, name: b.name, owed: toChips(b.principalWei + b.interestWei), principal: toChips(b.principalWei), rateBps: b.rateBps })) };
      publish(
        answer.decision.approve
          ? { bank: book, loans: [...round.loans, { ...entry, amount: answer.decision.amountChips, rateBps: answer.decision.rateBps }] }
          : { bank: book, refusals: [...round.refusals, entry] },
        "banking",
      );
    },
    { reasoning },
  );

  publish(
    {
      roundId: plan.roundId,
      bots: plan.bots.length,
      // The claimed seats, by name and face. A name is not an outcome: it is
      // true from the moment the round starts.
      fighters: fightersOf(plan),
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
        ...(d.evidence ? { evidence: { matches: d.evidence.matches, entered: d.evidence.entered, typicalStake: d.evidence.typicalStake } } : {}),
      })),
      loans: plan.loans.map((l) => ({ agentId: l.agentId, name: l.name, asked: toChips(l.askedWei), amount: toChips(l.principalWei), rateBps: l.rateBps, reason: l.reason, source: l.source, ...(l.evidence ? { evidence: { matches: l.evidence.matches, approved: l.evidence.approved, typicalAmount: l.evidence.typicalAmount } } : {}) })),
      // The refusal's own source, which used to be published as serv
      // whatever answered: a refusal written by the fixed lender read as
      // though Marrow had reasoned its way to it.
      refusals: plan.refusals.map((r) => ({ agentId: r.agentId, name: r.name, asked: toChips(r.askedWei), reason: r.reason, source: r.source, ...(r.evidence ? { evidence: { matches: r.evidence.matches, approved: r.evidence.approved, typicalAmount: r.evidence.typicalAmount } } : {}) })),
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

  // The draw, before the fight and after the money has moved. It is its own
  // phase with its own length so the reveal has somewhere to happen: the
  // fight's start time stays exactly what it says, rather than drifting by
  // however long a client decides to spin its reels for.
  publish(
    {
      reels: run.round.reels.map((pull, i) => ({
        entrantId: plan.entrants[i].id,
        symbols: [...pull.symbols],
        characterId: pull.characterId,
        tier: pull.characterTier,
        combo: pull.combo,
        bonusPct: pull.bonusPct,
      })),
    },
    "reels",
    { durationMs: REEL_REVEAL_MS },
  );
  await sleepMs(REEL_REVEAL_MS);

  // Picks, between the draw and the fight.
  //
  // Here because a viewer has to see what each agent drew before backing one,
  // and because the fight cannot have started: the outcome was fixed by the
  // seed at planning and is not published until the fight phase, so a window
  // that closed after it began would be a window on a known result.
  const backingMs = backingWindowSeconds() * 1_000;
  publish({}, "backing", { durationMs: backingMs });
  await sleepMs(backingMs);

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
        // Read back from the round store the settle just wrote, which is the
        // same place the lever route reads it, so the bankrolls panel draws
        // from one source whichever flow put it there.
        agents: (flow.store.get(plan.roundId)?.agents ?? []).map((a) => ({ agentId: a.agentId, name: a.name, balanceBeforeWei: a.balanceBeforeWei, balanceAfterWei: a.balanceAfterWei })),
        checks: run.reconciliation.checks,
        settles: ctx.chain.settles,
      },
    },
    "result",
  );

  const settled = store.read();
  store.write({ round, last: round, paused: settled.paused, nextRoundAt: new Date(nextAt).toISOString() });
  // Points for whoever called it, from the picks the window took and the
  // winner the round already has. Never money, and never a reason for a
  // finished round to be recorded as failed.
  settleBackingQuietly(ctx.env.dataDir, ctx.chain.network, plan.roundId, run.round.placements[0]!);
  log.info("arena round complete", { roundId: plan.roundId, winner: run.round.placements[0], reconciled: run.reconciliation.ok, durationMs });

  // The figures stand for a moment, then the pit is plainly waiting. A
  // resting phase with no reason is the ordinary gap between rounds, which is
  // what a viewer should see for most of an interval.
  const dwellMs = Math.min(RESULT_DWELL_MS, Math.max(0, nextAt - Date.now()));
  if (dwellMs > 0) await sleepMs(dwellMs);
  publish({}, "resting");
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

/** The claimed seats in a round, as the arena publishes them. */
function fightersOf(plan: RoundPlan): Array<{ handle: string; name: string; face: string; entrantId: string }> {
  return (plan.fighters ?? []).map((f) => ({ handle: f.handle, name: f.name, face: f.face, entrantId: f.entrantId }));
}

