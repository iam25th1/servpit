// Settling a round against a plan that was already made.
//
// This module must never decide anything. It collects the entries the plan
// recorded, resolves the fight, pays or retains, and reconciles. It imports
// nothing that can reach a model, which a guard test enforces by walking the
// import graph from the settle route.
//
// What the player sees must be exactly what settles, and that has failed
// twice by letting this path work out its own answer. It cannot any more.

import { DEFAULT_ROUND } from "@/config/round";
import { toChips } from "@/config/stake";
import { resolveRound } from "@/engine/resolveRound";
import { heuristicDecision } from "../decisions/heuristic";
import { log } from "../log";
import { fromWei, sumWei } from "../money";
import { reconcile } from "../reconcile";
import { collectEntry, payWinner, type TransferOutcome } from "../transfers";
import { splitPrize, type PrizeSplit } from "./prize";
import { bankEnabled } from "@/config/economy";
import { splitCappedPrize } from "@/economy/prize";
import type { FlowContext, RoundPlan, RoundRun } from "./types";
import { type StoredAgentRound } from "./store";

/**
 * The capped split in the shape reconciliation already speaks.
 *
 * Nothing goes to the bank out of a prize in this phase. The bank's share of
 * an unclaimed pot is a separate lever and is still zero, so a house win
 * rolls the whole prize over exactly as it does today.
 */
function cappedAsSplit(capped: ReturnType<typeof splitCappedPrize>): PrizeSplit {
  return { poolWei: capped.poolWei, rakeWei: capped.rakeWei, payoutWei: capped.payoutWei, toBankWei: 0n, nextRolloverWei: capped.nextRolloverWei };
}

export interface RunProgress {
  onEntry?: (agentId: string, outcome: TransferOutcome) => void;
}

export async function runRound(ctx: FlowContext, plan: RoundPlan, progress: RunProgress = {}): Promise<RoundRun> {
  const pot = ctx.wallets.pot;
  const watched = [pot.address, ...plan.snapshots.map((s) => s.address)];
  const before: Record<string, bigint> = {};
  const watchedWallets = [...plan.snapshots.map((s) => ctx.wallets.agents.get(s.profile.id)!), pot];
  ctx.bankroll.invalidate();
  // One request for all seven, rather than seven in a row.
  await ctx.bankroll.warm(ctx.chain, watchedWallets);
  for (const s of plan.snapshots) before[s.address] = await ctx.bankroll.get(ctx.wallets.agents.get(s.profile.id)!);
  before[pot.address] = await ctx.bankroll.get(pot);

  // Sequential on purpose. Each send waits for its own receipt before the
  // next nonce is requested, which is what makes a collision structurally
  // impossible on a chain where nonces are left to the node. It is also the
  // slowest part of a round, so each confirmation is reported as it lands
  // rather than all of them at the end.
  const entries: TransferOutcome[] = [];
  for (const entrant of plan.entering) {
    const wallet = ctx.wallets.agents.get(entrant.agentId)!;
    const outcome = await collectEntry({ ledger: ctx.ledger, bankroll: ctx.bankroll, network: ctx.chain.network, settles: ctx.chain.settles }, plan.roundId, entrant.agentId, wallet, pot, entrant.stakeWei);
    entries.push(outcome);
    progress.onEntry?.(entrant.agentId, outcome);
  }

  // The engine's stake must be the same number the chain moved, in chips.
  // They diverged once and the round collected 60000000000000 wei of entries
  // and paid out 2400.
  const round = resolveRound(plan.seed, plan.entrants, {
    ...DEFAULT_ROUND,
    stakeTiers: { ...DEFAULT_ROUND.stakeTiers, [DEFAULT_ROUND.stakeTier]: toChips(plan.stakeWei) },
  });
  const winnerEntrantId = round.placements[0];
  const winnerAgent = plan.entering.find((e) => e.entrantId === winnerEntrantId);

  // The engine's own pot charges all twenty four seats, and eighteen of them
  // are house bots that never paid anything. That number is a game display,
  // not money, and the pot wallet had to cover the difference out of its own
  // balance every time an agent won. The prize is now what the pot is
  // actually holding for this round: the entries that just landed in it plus
  // whatever rolled over from rounds nobody real won.
  //
  // Rollover is read by round id rather than as a running total, so a replay
  // of a settled round inherits the same number it did the first time.
  const entriesWei = sumWei(entries.map((e) => e.amountWei));
  const rolloverInWei = ctx.rollover.inputFor(plan.roundId);

  // With the bank off every seat costs the same, so the whole prize goes to
  // the winner and the two models agree. With it on, seats cost what each
  // agent chose, and a winner takes the share of the prize its own stake
  // earned against the biggest stake in the field. The rest rolls over,
  // which is what stops a floor stake sweeping a pot bigger stakers built.
  const highestStakeWei = plan.entering.reduce((most, e) => (e.stakeWei > most ? e.stakeWei : most), 0n);
  const prize = bankEnabled()
    ? cappedAsSplit(splitCappedPrize({ poolWei: entriesWei + rolloverInWei, rakeBps: DEFAULT_ROUND.rakeBps, winnerStakeWei: winnerAgent ? winnerAgent.stakeWei : null, highestStakeWei }))
    : splitPrize({ entriesWei, rolloverWei: rolloverInWei, rakeBps: DEFAULT_ROUND.rakeBps, agentWon: Boolean(winnerAgent) });
  const prizeWei = prize.payoutWei;

  let payout: TransferOutcome | null = null;
  let retained: { winnerEntrantId: string; amountWei: bigint } | null = null;
  if (winnerAgent && prizeWei > 0n) {
    const wallet = ctx.wallets.agents.get(winnerAgent.agentId)!;
    payout = await payWinner({ ledger: ctx.ledger, bankroll: ctx.bankroll, network: ctx.chain.network, settles: ctx.chain.settles }, plan.roundId, winnerAgent.agentId, pot, wallet, prizeWei);
  } else if (!winnerAgent) {
    retained = { winnerEntrantId, amountWei: prize.toBankWei + prize.nextRolloverWei };
    log.info("house bot won, prize rolls over into the next pot", {
      roundId: plan.roundId,
      winner: winnerEntrantId,
      retainedWei: retained.amountWei.toString(),
      nextRolloverWei: prize.nextRolloverWei.toString(),
      toBankWei: prize.toBankWei.toString(),
    });
  }

  // After the payout, so a failed send leaves the rollover untouched and the
  // next round inherits the same pot rather than one that has already been
  // spent on a transfer that never landed.
  ctx.rollover.record(plan.roundId, rolloverInWei, prize.nextRolloverWei);

  ctx.bankroll.invalidate();
  const after: Record<string, bigint> = {};
  await ctx.bankroll.warm(ctx.chain, watchedWallets);
  for (const s of plan.snapshots) after[s.address] = await ctx.bankroll.get(ctx.wallets.agents.get(s.profile.id)!);
  after[pot.address] = await ctx.bankroll.get(pot);

  const reconciliation = reconcile({
    potAddress: pot.address,
    before,
    after,
    entries: entries.map((e) => ({ address: e.from, amountWei: e.amountWei })),
    payouts: payout ? [{ address: payout.to, amountWei: payout.amountWei }] : [],
    appliedEntries: entries.filter((e) => e.applied).map((e) => ({ address: e.from, amountWei: e.amountWei })),
    appliedPayouts: payout?.applied ? [{ address: payout.to, amountWei: payout.amountWei }] : [],
    // Only what was actually sent in this window paid a fee. A replay of a
    // settled round resends nothing, so it owes nothing, and its wallet
    // deltas are zero on both sides.
    //
    // The fee is charged to the sender: an entry costs the agent, a payout
    // costs the pot. The pot's fee matters on any round it actually pays a
    // winner, which no settled round did until an agent finally won one.
    feesWei: [
      ...entries.filter((e) => e.applied).map((e) => ({ address: e.from, amountWei: e.feeWei ?? 0n })),
      ...(payout?.applied ? [{ address: payout.from, amountWei: payout.feeWei ?? 0n }] : []),
    ],
    // No house contribution any more: a seat that did not pay adds nothing to
    // the prize. What the pot brought in from previous rounds does, and it is
    // money the pot is already holding.
    rolloverInWei,
    nextRolloverWei: prize.nextRolloverWei,
    toBankWei: prize.toBankWei,
    rakeWei: prize.rakeWei,
  });
  if (!reconciliation.ok) {
    log.error("reconciliation failed", { roundId: plan.roundId, checks: reconciliation.checks.filter((c) => !c.ok) });
  }

  const agents: StoredAgentRound[] = plan.decisions.map((d) => {
    const entry = entries.find((e) => e.agentId === d.agentId);
    return {
      agentId: d.agentId,
      name: d.name,
      strategy: d.strategy,
      address: d.address,
      entered: d.decision.enter,
      stake: d.decision.stake,
      reason: d.decision.reason,
      source: d.source,
      rejection: d.rejection,
      model: d.model,
      balanceBeforeWei: (before[d.address] ?? 0n).toString(),
      balanceAfterWei: (after[d.address] ?? 0n).toString(),
      entryTxHash: entry?.txHash,
      entryLink: entry?.link ?? null,
      payoutTxHash: payout && payout.agentId === d.agentId ? payout.txHash : undefined,
      payoutLink: payout && payout.agentId === d.agentId ? payout.link : null,
    };
  });

  ctx.store.save({
    roundId: plan.roundId,
    seed: plan.seed,
    createdAt: new Date().toISOString(),
    network: ctx.chain.network,
    entrants: plan.entrants.length,
    winner: winnerEntrantId,
    potWei: prize.poolWei.toString(),
    rakeWei: prize.rakeWei.toString(),
    agents,
    reconciled: reconciliation.ok,
    servCalls: plan.servCalls,
    servMicroCents: ctx.meter.estimatedMicroCents,
  });

  log.info("round complete", {
    roundId: plan.roundId,
    winner: winnerEntrantId,
    entered: plan.entering.length,
    bots: plan.bots.length,
    poolWei: prize.poolWei.toString(),
    rolloverInWei: rolloverInWei.toString(),
    nextRolloverWei: prize.nextRolloverWei.toString(),
    prizeWei: prizeWei.toString(),
    reconciled: reconciliation.ok,
    watched: watched.length,
    payoutMinorUnits: fromWei(prizeWei),
  });

  return { plan, round, entries, payout, retained, prize, rolloverInWei, reconciliation };
}

export { heuristicDecision };
