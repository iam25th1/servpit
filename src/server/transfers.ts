// Entry and payout transfers: plain native transfers between smart
// wallets, one user operation each, keyed by round id and agent id, with
// the bankroll cache invalidated for both parties so the next read comes
// from the chain.

import { BankrollCache } from "./bankroll";
import { idempotencyKey } from "./idempotency";
import { TransferLedger, type TransferRecord } from "./ledger";
import { basescanTx } from "./money";
import type { Wallet } from "./wallets/types";

export interface TransferContext {
  ledger: TransferLedger;
  bankroll: BankrollCache;
  network: string;
  /** True when the chain settles for real, so a hash is worth linking. */
  settles: boolean;
}

export interface TransferOutcome extends TransferRecord {
  /** Basescan link on the cdp backend, null on the fake chain. */
  link: string | null;
  /** False when the ledger already held a complete record, so nothing moved now. */
  applied: boolean;
}

function finish(ctx: TransferContext, record: TransferRecord, from: Wallet, to: Wallet, applied: boolean): TransferOutcome {
  ctx.bankroll.invalidate(from.address);
  ctx.bankroll.invalidate(to.address);
  return { ...record, link: ctx.settles && record.txHash ? basescanTx(ctx.network, record.txHash) : null, applied };
}

/** Agent wallet to pot wallet, amount = the round stake. */
export async function collectEntry(ctx: TransferContext, roundId: string, agentId: string, agent: Wallet, pot: Wallet, stakeWei: bigint): Promise<TransferOutcome> {
  const key = idempotencyKey(roundId, agentId, "entry");
  const applied = ctx.ledger.get(key)?.status !== "complete";
  const record = await ctx.ledger.transferOnce({
    key,
    roundId,
    agentId,
    kind: "entry",
    from: agent,
    to: pot.address,
    amountWei: stakeWei,
    network: ctx.network,
  });
  return finish(ctx, record, agent, pot, applied);
}

/** Pot wallet to the winning agent, amount = pot minus rake as the engine computed it. */
export async function payWinner(ctx: TransferContext, roundId: string, agentId: string, pot: Wallet, winner: Wallet, amountWei: bigint): Promise<TransferOutcome> {
  const key = idempotencyKey(roundId, agentId, "payout");
  const applied = ctx.ledger.get(key)?.status !== "complete";
  const record = await ctx.ledger.transferOnce({
    key,
    roundId,
    agentId,
    kind: "payout",
    from: pot,
    to: winner.address,
    amountWei,
    network: ctx.network,
  });
  return finish(ctx, record, pot, winner, applied);
}

/**
 * The bank to an agent, for a loan the bank already agreed to in the plan.
 *
 * Disbursed before entries are collected, because an agent that borrowed to
 * reach its stake has to be holding the chips before that stake is taken.
 *
 * The rate is recorded with the principal, so what the debt costs to carry is
 * on the same record as the debt. Accruing and collecting it is a later
 * phase; this is what that will read.
 */
export async function disburseLoan(
  ctx: TransferContext,
  roundId: string,
  agentId: string,
  bank: Wallet,
  borrower: Wallet,
  principalWei: bigint,
  rateBps: number,
): Promise<TransferOutcome> {
  const key = idempotencyKey(roundId, agentId, "loan");
  const applied = ctx.ledger.get(key)?.status !== "complete";
  const record = await ctx.ledger.transferOnce({
    key,
    roundId,
    agentId,
    kind: "loan",
    from: bank,
    to: borrower.address,
    amountWei: principalWei,
    network: ctx.network,
    rateBps,
  });
  return finish(ctx, record, bank, borrower, applied);
}

/**
 * A winner to the bank, for what it owed.
 *
 * Interest before principal, which the rules module decides and this only
 * carries out. It runs after the pot has paid the winner, because the chips
 * have to arrive before they can be handed on, and before the agent is
 * treated as keeping anything.
 */
export async function repayBank(ctx: TransferContext, roundId: string, agentId: string, borrower: Wallet, bank: Wallet, amountWei: bigint): Promise<TransferOutcome> {
  const key = idempotencyKey(roundId, agentId, "repayment");
  const applied = ctx.ledger.get(key)?.status !== "complete";
  const record = await ctx.ledger.transferOnce({ key, roundId, agentId, kind: "repayment", from: borrower, to: bank.address, amountWei, network: ctx.network });
  return finish(ctx, record, borrower, bank, applied);
}

/** A wrecked agent to the bank, for whatever it still holds. */
export async function seizeToBank(ctx: TransferContext, roundId: string, agentId: string, wrecked: Wallet, bank: Wallet, amountWei: bigint): Promise<TransferOutcome> {
  const key = idempotencyKey(roundId, agentId, "seizure");
  const applied = ctx.ledger.get(key)?.status !== "complete";
  const record = await ctx.ledger.transferOnce({ key, roundId, agentId, kind: "seizure", from: wrecked, to: bank.address, amountWei, network: ctx.network });
  return finish(ctx, record, wrecked, bank, applied);
}

/** Operator capital into an emptied seat, so a replacement can play. */
export async function refillSeat(ctx: TransferContext, roundId: string, agentId: string, operator: Wallet, seat: Wallet, amountWei: bigint): Promise<TransferOutcome> {
  const key = idempotencyKey(roundId, agentId, "refill");
  const applied = ctx.ledger.get(key)?.status !== "complete";
  const record = await ctx.ledger.transferOnce({ key, roundId, agentId, kind: "refill", from: operator, to: seat.address, amountWei, network: ctx.network });
  return finish(ctx, record, operator, seat, applied);
}
