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
import { fromWei, toWei } from "../money";
import { reconcile } from "../reconcile";
import { collectEntry, payWinner, type TransferOutcome } from "../transfers";
import type { FlowContext, RoundPlan, RoundRun } from "./types";
import { type StoredAgentRound } from "./store";

export interface RunProgress {
  onEntry?: (agentId: string, outcome: TransferOutcome) => void;
}

export async function runRound(ctx: FlowContext, plan: RoundPlan, progress: RunProgress = {}): Promise<RoundRun> {
  const pot = ctx.wallets.pot;
  const watched = [pot.address, ...plan.snapshots.map((s) => s.address)];
  const before: Record<string, bigint> = {};
  ctx.bankroll.invalidate();
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
  const prize = round.payouts.find((p) => p.entrantId === winnerEntrantId)?.amount ?? 0;
  const prizeWei = toWei(prize);

  let payout: TransferOutcome | null = null;
  let retained: { winnerEntrantId: string; amountWei: bigint } | null = null;
  if (winnerAgent) {
    const wallet = ctx.wallets.agents.get(winnerAgent.agentId)!;
    payout = await payWinner({ ledger: ctx.ledger, bankroll: ctx.bankroll, network: ctx.chain.network, settles: ctx.chain.settles }, plan.roundId, winnerAgent.agentId, pot, wallet, prizeWei);
  } else {
    retained = { winnerEntrantId, amountWei: prizeWei };
    log.info("house bot won, prize retained in the pot", { roundId: plan.roundId, winner: winnerEntrantId, prizeWei: prizeWei.toString() });
  }

  ctx.bankroll.invalidate();
  const after: Record<string, bigint> = {};
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
    houseContributionWei: plan.stakeWei * BigInt(plan.bots.length),
    rakeWei: toWei(round.rake),
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
    potWei: toWei(round.pot).toString(),
    rakeWei: toWei(round.rake).toString(),
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
    potWei: toWei(round.pot).toString(),
    prizeWei: prizeWei.toString(),
    reconciled: reconciliation.ok,
    watched: watched.length,
    payoutMinorUnits: fromWei(prizeWei),
  });

  return { plan, round, entries, payout, retained, reconciliation };
}

export { heuristicDecision };
