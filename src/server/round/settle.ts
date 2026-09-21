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
import { collectEntry, disburseLoan, payWinner, refillSeat, repayBank, seizeToBank, type TransferOutcome } from "../transfers";
import { repay } from "@/economy/rules";
import { totalOwed } from "./debt";
import { overReached, type WreckRecord, type WreckTrigger } from "./wrecks";
import { CREDIT_TERMS } from "@/config/economy";
import { faceFor, generationOf, profileFor } from "@/config/replacements";
import { CHIPS_PER_FUNDED_WALLET } from "@/config/stake";
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
  onLoan?: (agentId: string, outcome: TransferOutcome) => void;
}

export async function runRound(ctx: FlowContext, plan: RoundPlan, progress: RunProgress = {}): Promise<RoundRun> {
  const pot = ctx.wallets.pot;
  const watched = [pot.address, ...plan.snapshots.map((s) => s.address)];
  const bank = ctx.wallets.bank;
  const operator = ctx.wallets.operator;
  const before: Record<string, bigint> = {};
  const watchedWallets = [...plan.snapshots.map((s) => ctx.wallets.agents.get(s.profile.id)!), pot, ...(bank ? [bank] : []), ...(operator ? [operator] : [])];
  ctx.bankroll.invalidate();
  // One request for all seven, rather than seven in a row.
  await ctx.bankroll.warm(ctx.chain, watchedWallets);
  for (const s of plan.snapshots) before[s.address] = await ctx.bankroll.get(ctx.wallets.agents.get(s.profile.id)!);
  before[pot.address] = await ctx.bankroll.get(pot);
  if (bank) before[bank.address] = await ctx.bankroll.get(bank);
  if (operator) before[operator.address] = await ctx.bankroll.get(operator);

  // Sequential on purpose. Each send waits for its own receipt before the
  // next nonce is requested, which is what makes a collision structurally
  // impossible on a chain where nonces are left to the node. It is also the
  // slowest part of a round, so each confirmation is reported as it lands
  // rather than all of them at the end.
  // Interest first, before this round's lending. Once per round on principal
  // outstanding at the start of it, simple rather than compound, whether or
  // not the agent entered: a debt costs the same to carry whether you play or
  // sit.
  //
  // Before the disbursement below, deliberately. A loan taken this round has
  // not been carried for a round yet, and charging it on arrival would take
  // interest for time that has not passed.
  //
  // Idempotent by round id inside the store, so settling the same round twice
  // charges once.
  const interest: Array<{ agentId: string; chargedWei: bigint; rateBps: number }> = [];
  if (bankEnabled()) {
    for (const snapshot of plan.snapshots) {
      const walletId = snapshot.profile.id;
      const identityId = ctx.debts.currentIdentity(walletId);
      const { debt, chargedWei } = ctx.debts.accrue(walletId, identityId, plan.roundId);
      if (chargedWei > 0n) {
        interest.push({ agentId: walletId, chargedWei, rateBps: debt.rateBps });
        log.info("interest charged", { roundId: plan.roundId, agentId: walletId, chargedWei: chargedWei.toString(), rateBps: debt.rateBps, owedWei: totalOwed(debt).toString() });
      }
    }
  }

  // The bank pays out first. An agent that borrowed to reach its stake has to
  // be holding the chips before that stake is taken off it, and the plan
  // already says exactly who is owed what.
  const transferCtx = { ledger: ctx.ledger, bankroll: ctx.bankroll, network: ctx.chain.network, settles: ctx.chain.settles };
  const loans: TransferOutcome[] = [];
  if (bank) {
    for (const loan of plan.loans) {
      const borrower = ctx.wallets.agents.get(loan.agentId);
      if (!borrower) continue;
      const outcome = await disburseLoan(transferCtx, plan.roundId, loan.agentId, bank, borrower, loan.principalWei, loan.rateBps);
      loans.push(outcome);
      if (outcome.applied) ctx.debts.addLoan(loan.agentId, ctx.debts.currentIdentity(loan.agentId), loan.principalWei, loan.rateBps);
      progress.onLoan?.(loan.agentId, outcome);
      log.info("loan disbursed", { roundId: plan.roundId, agentId: loan.agentId, principalWei: loan.principalWei.toString(), rateBps: loan.rateBps, txHash: outcome.txHash });
    }
  }

  const entries: TransferOutcome[] = [];
  for (const entrant of plan.entering) {
    const wallet = ctx.wallets.agents.get(entrant.agentId)!;
    const outcome = await collectEntry(transferCtx, plan.roundId, entrant.agentId, wallet, pot, entrant.stakeWei);
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
    payout = await payWinner(transferCtx, plan.roundId, winnerAgent.agentId, pot, wallet, prizeWei);
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

  // Winnings answer to the bank first. The pot has paid the winner, so the
  // chips are in its wallet; what it owes goes straight back out before it is
  // treated as keeping anything.
  let repayment: RoundRun["repayment"] = null;
  if (bankEnabled() && bank && payout && winnerAgent) {
    const walletId = winnerAgent.agentId;
    const identityId = ctx.debts.currentIdentity(walletId);
    const owed = ctx.debts.get(walletId, identityId);
    if (totalOwed(owed) > 0n) {
      // The rules module decides the split, interest before principal. This
      // only carries it out.
      const split = repay({ principalWei: owed.principalWei, interestWei: owed.interestWei }, payout.amountWei);
      const handedBackWei = split.interestPaidWei + split.principalPaidWei;
      if (handedBackWei > 0n) {
        const wallet = ctx.wallets.agents.get(walletId)!;
        const outcome = await repayBank(transferCtx, plan.roundId, walletId, wallet, bank, handedBackWei);
        if (outcome.applied) ctx.debts.settle(walletId, identityId, split.principalPaidWei, split.interestPaidWei);
        repayment = { agentId: walletId, interestWei: split.interestPaidWei, principalWei: split.principalPaidWei, outcome };
        log.info("winnings garnished", {
          roundId: plan.roundId,
          agentId: walletId,
          interestWei: split.interestPaidWei.toString(),
          principalWei: split.principalPaidWei.toString(),
          keptWei: split.leftoverWei.toString(),
        });
      }
    }
  }

  ctx.bankroll.invalidate();
  // Read once here, because a wreck is decided on what an agent is left
  // holding after the round rather than what it started with.
  const settledBalances = new Map<string, bigint>();
  for (const snapshot of plan.snapshots) {
    const wallet = ctx.wallets.agents.get(snapshot.profile.id)!;
    settledBalances.set(snapshot.profile.id, await ctx.bankroll.get(wallet));
  }

  // Who is finished. Two conditions, and they are different failures: owing
  // more than the ceiling allows, or unable to afford a seat with nobody
  // willing to cover it.
  const wrecks: WreckRecord[] = [];
  const seizures: TransferOutcome[] = [];
  const refills: TransferOutcome[] = [];
  const replacements: RoundRun["replacements"] = [];
  if (bankEnabled() && bank) {
    const ceilingWei = CREDIT_TERMS.debtCeilingStakes * plan.stakeWei;
    const denied = new Set(plan.deniedCredit);
    for (const snapshot of plan.snapshots) {
      const walletId = snapshot.profile.id;
      const identityId = ctx.debts.currentIdentity(walletId);
      const owed = ctx.debts.get(walletId, identityId);
      const balanceWei = settledBalances.get(walletId) ?? 0n;

      const trigger: WreckTrigger | null =
        totalOwed(owed) > ceilingWei ? "debt above the ceiling" : denied.has(walletId) && balanceWei < plan.stakeWei ? "broke and denied credit" : null;
      if (trigger === null) continue;

      // The bank takes what is there and writes off the rest. It can never
      // take more than is owed: seizing beyond the debt would be taking money
      // nobody is owed.
      const owedWei = totalOwed(owed);
      const seizedWei = balanceWei < owedWei ? balanceWei : owedWei;
      let seizure: TransferOutcome | null = null;
      if (seizedWei > 0n) {
        const wallet = ctx.wallets.agents.get(walletId)!;
        seizure = await seizeToBank(transferCtx, plan.roundId, walletId, wallet, bank, seizedWei);
        seizures.push(seizure);
      }
      const split = repay({ principalWei: owed.principalWei, interestWei: owed.interestWei }, seizedWei);
      const writtenOffWei = split.debt.principalWei + split.debt.interestWei;

      const history = ctx.store.historyFor(walletId, owed.bornAtRound, toChips(plan.stakeWei));
      const record: WreckRecord = {
        roundId: plan.roundId,
        walletId,
        identityId,
        name: snapshot.profile.name,
        trigger,
        balanceAtDeathWei: balanceWei.toString(),
        debtAtDeathWei: owedWei.toString(),
        principalAtDeathWei: owed.principalWei.toString(),
        interestAtDeathWei: owed.interestWei.toString(),
        seizedWei: seizedWei.toString(),
        writtenOffWei: writtenOffWei.toString(),
        peakBalanceWei: history.peakBalanceWei.toString(),
        // From the debt itself, which counts per identity. Reading the
        // ledger's loan records would credit this agent with the borrowings
        // of whoever held the seat before it.
        borrowedWei: owed.borrowedWei.toString(),
        loanCount: owed.loanCount,
        recentStakeMultiples: history.recentStakeMultiples,
        roundsSurvived: history.roundsSurvived,
        wins: history.wins,
        at: new Date().toISOString(),
      };
      wrecks.push(record);
      ctx.wreckStore.save(record);

      // The seat gets a new occupant, and the debt dies with the one that
      // owed it. The identity is what a debt is stamped with, so bumping it
      // is what makes the next agent clean rather than an act of forgiveness.
      const nextIdentityId = `${walletId}-${generationOf(identityId) + 1}`;
      ctx.debts.clear(walletId, nextIdentityId, plan.roundId);
      const arrival: RoundRun["replacements"][number] = {
        walletId,
        identityId: nextIdentityId,
        name: profileFor(walletId, nextIdentityId).name,
        face: faceFor(walletId, nextIdentityId),
        fundedWei: 0n,
        outcome: null,
      };

      // Funded from operator capital, never from an agent's playing balance
      // and never out of the prize pool. A seat with nobody solvent in it is
      // not a seat.
      if (operator) {
        const seatWei = plan.stakeWei * BigInt(CHIPS_PER_FUNDED_WALLET) / BigInt(toChips(plan.stakeWei) || 1);
        const operatorWei = await ctx.bankroll.get(operator);
        const fundingWei = operatorWei >= seatWei ? seatWei : operatorWei;
        if (fundingWei > 0n) {
          const seat = ctx.wallets.agents.get(walletId)!;
          arrival.outcome = await refillSeat(transferCtx, plan.roundId, walletId, operator, seat, fundingWei);
          arrival.fundedWei = fundingWei;
          refills.push(arrival.outcome);
        } else {
          log.warn("no operator capital to refill a seat", { roundId: plan.roundId, agentId: walletId });
        }
      }
      replacements.push(arrival);
      log.info("seat refilled", { roundId: plan.roundId, walletId, identityId: nextIdentityId, name: arrival.name, fundedWei: arrival.fundedWei.toString() });
      log.warn("agent wrecked", {
        roundId: plan.roundId,
        agentId: walletId,
        trigger,
        overReached: overReached(record),
        seizedWei: record.seizedWei,
        writtenOffWei: record.writtenOffWei,
        roundsSurvived: record.roundsSurvived,
      });
    }
  }

  ctx.bankroll.invalidate();
  const after: Record<string, bigint> = {};
  await ctx.bankroll.warm(ctx.chain, watchedWallets);
  for (const s of plan.snapshots) after[s.address] = await ctx.bankroll.get(ctx.wallets.agents.get(s.profile.id)!);
  after[pot.address] = await ctx.bankroll.get(pot);
  if (bank) after[bank.address] = await ctx.bankroll.get(bank);
  if (operator) after[operator.address] = await ctx.bankroll.get(operator);

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
      ...loans.filter((l) => l.applied).map((l) => ({ address: l.from, amountWei: l.feeWei ?? 0n })),
      ...(payout?.applied ? [{ address: payout.from, amountWei: payout.feeWei ?? 0n }] : []),
      ...(repayment?.outcome.applied ? [{ address: repayment.outcome.from, amountWei: repayment.outcome.feeWei ?? 0n }] : []),
      ...seizures.filter((x) => x.applied).map((x) => ({ address: x.from, amountWei: x.feeWei ?? 0n })),
      ...refills.filter((x) => x.applied).map((x) => ({ address: x.from, amountWei: x.feeWei ?? 0n })),
    ],
    loans: loans.map((l) => ({ address: l.to, amountWei: l.amountWei })),
    appliedLoans: loans.filter((l) => l.applied).map((l) => ({ address: l.to, amountWei: l.amountWei })),
    operatorAddress: operator?.address,
    operatorFunding: refills.map((r) => ({ address: r.to, amountWei: r.amountWei })),
    appliedOperatorFunding: refills.filter((r) => r.applied).map((r) => ({ address: r.to, amountWei: r.amountWei })),
    repayments: [
      ...(repayment ? [{ address: repayment.outcome.from, amountWei: repayment.outcome.amountWei }] : []),
      // A seizure leaves an agent for the bank, exactly like a repayment.
      // The only difference is who decided it.
      ...seizures.map((x) => ({ address: x.from, amountWei: x.amountWei })),
    ],
    appliedRepayments: [
      ...(repayment?.outcome.applied ? [{ address: repayment.outcome.from, amountWei: repayment.outcome.amountWei }] : []),
      ...seizures.filter((x) => x.applied).map((x) => ({ address: x.from, amountWei: x.amountWei })),
    ],
    ...(bank ? { bankAddress: bank.address } : {}),
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

  return { plan, round, entries, loans, interest, repayment, wrecks, seizures, replacements, payout, retained, prize, rolloverInWei, reconciliation };
}

export { heuristicDecision };
