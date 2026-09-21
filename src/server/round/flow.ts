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
import { stakeWeiFrom, toChips } from "@/config/stake";
import { resolveRound, type Entrant, type RoundResult } from "@/engine/resolveRound";
import type { BankrollCache } from "../bankroll";
import { decideForAgents, heuristicDecision } from "../decisions/decide";
import type { AgentDecision, AgentSnapshot, RoundContext } from "../decisions/types";
import type { TransferLedger } from "../ledger";
import type { PlanCache } from "./planCache";
import { log } from "../log";
import { fromWei, toWei } from "../money";
import { reconcile, type ReconcileResult } from "../reconcile";
import type { CostMeter, ServClient } from "../serv/client";
import { collectEntry, payWinner, type TransferOutcome } from "../transfers";
import type { Chain } from "../wallets/types";
import type { Wallets } from "../wallets/open";
import { RoundStore, type StoredAgentRound } from "./store";

export interface FlowContext {
  /** Plans already quoted, so a settle does not re-run the decision loop. */
  plans?: PlanCache;
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
  /**
   * Set when a house bot won. Eighteen of the twenty four entrants have no
   * wallet, so there is no payout to make and the prize stays in the pot.
   * Reported rather than only logged, because otherwise the result screen
   * shows entries that do not add up to the pot and nothing saying why.
   */
  retained: { winnerEntrantId: string; amountWei: bigint } | null;
  reconciliation: ReconcileResult;
}

const SEED = /^[A-Za-z0-9_-]{1,64}$/;

/** Round id is derived from the seed and entrant count so a retry keys the same transfers. */
export function roundIdFor(seed: string, entrants: number): string {
  const digest = createHash("sha256").update(`servpit-round/${seed}/${entrants}`).digest("hex").slice(0, 16);
  return `r-${digest}`;
}

export async function planRound(ctx: FlowContext, seed: string, onDecided?: (decision: AgentDecision) => void): Promise<RoundPlan> {
  if (!SEED.test(seed)) throw new RangeError(`seed must match ${SEED}`);
  // A share of a funded wallet rather than a flat amount, so an agent can
  // actually run low and its reasoning has something to weigh.
  const stakeWei = stakeWeiFrom();
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
  const run = await decideForAgents({ client: ctx.serv, meter: ctx.meter }, snapshots, context, onDecided);

  // Final gate before money moves: the chain, not the model, decides who can
  // enter. Gas is no longer sponsored, so the bar is the stake plus whatever
  // the chain says to keep back; an agent that can cover only the stake would
  // revert part way through the round.
  const required = stakeWei + ctx.chain.gasReserveWei;
  const decisions: AgentDecision[] = [];
  const entering: EnteringAgent[] = [];
  for (const decision of run.decisions) {
    const snapshot = snapshots.find((s) => s.profile.id === decision.agentId)!;
    if (decision.decision.enter && snapshot.balanceWei < required) {
      // Plain words and chips: this line is shown to the player, not only
      // logged. "short on gas" and "short on stake" stay as the two cases so
      // an operator can still tell them apart at a glance.
      const shortfall = ctx.chain.gasReserveWei > 0n && snapshot.balanceWei >= stakeWei ? "gas" : "stake";
      const held = toChips(snapshot.balanceWei);
      const seat = toChips(stakeWei);
      const reason =
        shortfall === "gas"
          ? `has ${held} chips but not enough left over for fees, so it is short on gas`
          : `has ${held} chips, and a seat costs ${seat}, so it is short on stake`;
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

/** Told as each entry confirms on chain, so a caller can show it landing. */
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

  const round = resolveRound(plan.seed, plan.entrants, DEFAULT_ROUND);
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
    // costs the pot. The pot is not checked per wallet, so its fee is read
    // and simply never used, which is correct rather than an oversight.
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
