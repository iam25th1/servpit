// The full round flow.
//
//   planRound   read balances from chain, ask SERV per named agent, validate
//               locally, drop anyone the chain says cannot cover the stake,
//               fill the remaining seats with heuristic bots.
//   runRound    collect entries, resolve the round with the phase 1 engine,
//               pay the winner, reconcile against chain balances, record it.
//
// House bots do not hold wallets. The operator pot covers their seats, so
// their stake is already inside the pot; reconciliation accounts for that as
// houseContributionWei. Stated, not hidden: see the README.

import { createHash } from "node:crypto";
import { NAMED_AGENTS } from "@/config/agents";
import { DEFAULT_ROUND } from "@/config/round";
import { resolveRound, type Entrant, type RoundResult } from "@/engine/resolveRound";
import type { BankrollCache } from "../bankroll";
import { decideForAgents, heuristicDecision } from "../decisions/decide";
import type { AgentDecision, AgentSnapshot, RoundContext } from "../decisions/types";
import type { TransferLedger } from "../ledger";
import { log } from "../log";
import { fromWei, toWei } from "../money";
import { reconcile, type ReconcileResult } from "../reconcile";
import type { CostMeter, ServClient } from "../serv/client";
import { collectEntry, payWinner, type TransferOutcome } from "../transfers";
import type { Chain } from "../wallets/types";
import type { Wallets } from "../wallets/open";
import { RoundStore, type StoredAgentRound } from "./store";

export interface FlowContext {
  chain: Chain;
  wallets: Wallets;
  ledger: TransferLedger;
  store: RoundStore;
  bankroll: BankrollCache;
  meter: CostMeter;
  serv?: ServClient;
  entrants: number;
}

export interface EnteringAgent {
  agentId: string;
  entrantId: string;
  stakeWei: bigint;
}

export interface RoundPlan {
  roundId: string;
  seed: string;
  stakeWei: bigint;
  decisions: AgentDecision[];
  snapshots: AgentSnapshot[];
  entering: EnteringAgent[];
  bots: string[];
  entrants: Entrant[];
  servCalls: number;
  guardRefusals: number;
  rejections: Array<{ agentId: string; reason: string }>;
}

export interface RoundRun {
  plan: RoundPlan;
  round: RoundResult;
  entries: TransferOutcome[];
  payout: TransferOutcome | null;
  reconciliation: ReconcileResult;
}

const SEED = /^[A-Za-z0-9_-]{1,64}$/;

/** Round id is derived from the seed and entrant count so a retry keys the same transfers. */
export function roundIdFor(seed: string, entrants: number): string {
  const digest = createHash("sha256").update(`servpit-round/${seed}/${entrants}`).digest("hex").slice(0, 16);
  return `r-${digest}`;
}

export async function planRound(ctx: FlowContext, seed: string): Promise<RoundPlan> {
  if (!SEED.test(seed)) throw new RangeError(`seed must match ${SEED}`);
  const stakeWei = toWei(DEFAULT_ROUND.stakeTiers[DEFAULT_ROUND.stakeTier]);
  const roundId = roundIdFor(seed, ctx.entrants);

  ctx.bankroll.invalidate();
  const snapshots: AgentSnapshot[] = [];
  for (const profile of NAMED_AGENTS) {
    const wallet = ctx.wallets.agents.get(profile.id);
    if (!wallet) continue;
    snapshots.push({
      profile,
      address: wallet.address,
      balanceWei: await ctx.bankroll.get(wallet),
      stakeWei,
      recentOutcomes: ctx.store.outcomesFor(profile.id),
    });
  }

  const context: RoundContext = { roundId, participants: ctx.entrants, poolWei: stakeWei * BigInt(ctx.entrants), stakeWei };
  const run = await decideForAgents({ client: ctx.serv, meter: ctx.meter }, snapshots, context);

  // Final gate before money moves: the chain, not the model, decides who can enter.
  const decisions: AgentDecision[] = [];
  const entering: EnteringAgent[] = [];
  for (const decision of run.decisions) {
    const snapshot = snapshots.find((s) => s.profile.id === decision.agentId)!;
    if (decision.decision.enter && snapshot.balanceWei < stakeWei) {
      const reason = `balance ${snapshot.balanceWei} wei cannot cover the ${stakeWei} wei allocation`;
      log.warn("entry blocked by on chain balance", { agentId: decision.agentId, reason });
      decisions.push({ ...decision, decision: { enter: false, stake: 0, reason: `excluded: ${reason}` }, rejection: decision.rejection ? `${decision.rejection}; ${reason}` : reason });
      continue;
    }
    decisions.push(decision);
    if (decision.decision.enter) entering.push({ agentId: decision.agentId, entrantId: `agent-${decision.agentId}`, stakeWei });
  }

  const botCount = Math.max(0, ctx.entrants - entering.length);
  const bots = Array.from({ length: botCount }, (_, i) => `bot-${String(i).padStart(2, "0")}`);
  const entrants: Entrant[] = [...entering.map((e) => ({ id: e.entrantId })), ...bots.map((id) => ({ id }))];

  return { roundId, seed, stakeWei, decisions, snapshots, entering, bots, entrants, servCalls: run.servCalls, guardRefusals: run.guardRefusals, rejections: run.rejections };
}

export async function runRound(ctx: FlowContext, plan: RoundPlan): Promise<RoundRun> {
  const pot = ctx.wallets.pot;
  const watched = [pot.address, ...plan.snapshots.map((s) => s.address)];
  const before: Record<string, bigint> = {};
  ctx.bankroll.invalidate();
  for (const s of plan.snapshots) before[s.address] = await ctx.bankroll.get(ctx.wallets.agents.get(s.profile.id)!);
  before[pot.address] = await ctx.bankroll.get(pot);

  const entries: TransferOutcome[] = [];
  for (const entrant of plan.entering) {
    const wallet = ctx.wallets.agents.get(entrant.agentId)!;
    entries.push(await collectEntry({ ledger: ctx.ledger, bankroll: ctx.bankroll, network: ctx.chain.network, settles: ctx.chain.settles }, plan.roundId, entrant.agentId, wallet, pot, entrant.stakeWei));
  }

  const round = resolveRound(plan.seed, plan.entrants, DEFAULT_ROUND);
  const winnerEntrantId = round.placements[0];
  const winnerAgent = plan.entering.find((e) => e.entrantId === winnerEntrantId);
  const prize = round.payouts.find((p) => p.entrantId === winnerEntrantId)?.amount ?? 0;
  const prizeWei = toWei(prize);

  let payout: TransferOutcome | null = null;
  if (winnerAgent) {
    const wallet = ctx.wallets.agents.get(winnerAgent.agentId)!;
    payout = await payWinner({ ledger: ctx.ledger, bankroll: ctx.bankroll, network: ctx.chain.network, settles: ctx.chain.settles }, plan.roundId, winnerAgent.agentId, pot, wallet, prizeWei);
  } else {
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

  return { plan, round, entries, payout, reconciliation };
}

export { heuristicDecision };
