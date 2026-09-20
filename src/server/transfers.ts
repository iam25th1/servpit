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
