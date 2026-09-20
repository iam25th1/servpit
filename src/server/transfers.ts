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
  chainKind: "fake" | "cdp";
}

export interface TransferOutcome extends TransferRecord {
  /** Basescan link on the cdp backend, null on the fake chain. */
  link: string | null;
}

function finish(ctx: TransferContext, record: TransferRecord, from: Wallet, to: Wallet): TransferOutcome {
  ctx.bankroll.invalidate(from.address);
  ctx.bankroll.invalidate(to.address);
  return { ...record, link: ctx.chainKind === "cdp" && record.txHash ? basescanTx(ctx.network, record.txHash) : null };
}

/** Agent wallet to pot wallet, amount = the round stake. */
export async function collectEntry(ctx: TransferContext, roundId: string, agentId: string, agent: Wallet, pot: Wallet, stakeWei: bigint): Promise<TransferOutcome> {
  const record = await ctx.ledger.transferOnce({
    key: idempotencyKey(roundId, agentId, "entry"),
    roundId,
    agentId,
    kind: "entry",
    from: agent,
    to: pot.address,
    amountWei: stakeWei,
    network: ctx.network,
  });
  return finish(ctx, record, agent, pot);
}

/** Pot wallet to the winning agent, amount = pot minus rake as the engine computed it. */
export async function payWinner(ctx: TransferContext, roundId: string, agentId: string, pot: Wallet, winner: Wallet, amountWei: bigint): Promise<TransferOutcome> {
  const record = await ctx.ledger.transferOnce({
    key: idempotencyKey(roundId, agentId, "payout"),
    roundId,
    agentId,
    kind: "payout",
    from: pot,
    to: winner.address,
    amountWei,
    network: ctx.network,
  });
  return finish(ctx, record, pot, winner);
}
