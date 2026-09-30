// What a transfer's fee actually was, asked of the chain at reconcile time.
//
// The fee a plain account pays comes out of its balance alongside the stake,
// so every wallet check adds it back: the stake movement is the balance delta
// with the fee added. That figure used to come from the receipt as it was read
// the moment the transfer confirmed, and on Base Sepolia that reading is not
// final. Measured over 70 consecutive live transfers, 39 of them recorded a
// fee larger than the fee the same receipt reports once the block has settled,
// and none recorded a smaller one. The L2 component was identical every time
// (21,000 gas at 6 gwei); the whole difference was in the L1 data fee, which
// is the part the sequencer works out from the L1 attributes of the block.
//
// The effect was 99 of the 200 rounds on file marked unreconciled while every
// coin was where it should be: 95 failed a wallet check and 4 failed the pot
// check, each by exactly the gap between the fee recorded and the fee charged.
//
// The settle path already reads the chain again when a check fails, because a
// balance can lag a receipt. It re-read the balances and reused the fee, so a
// wrong fee could never clear. Now the fee is re-read with them. The value
// still comes from a receipt and is never derived from the gap between
// expected and observed: deriving it would make every wallet check pass by
// construction, which on a money surface is worse than the wrong answer.

/** What this module needs of a wallet: a receipt, read again. */
export interface ReceiptReader {
  awaitReceipt(txHash: string): Promise<{ feeWei: bigint }>;
}

/** A transfer that actually moved, as the ledger recorded it. */
export interface AppliedTransfer {
  /** The ledger key, so a correction can be written back to the record. */
  key: string;
  /** The sender, which is the wallet that paid the fee. */
  from: string;
  txHash?: string;
  /** What the ledger holds, used when the chain cannot be asked again. */
  feeWei?: bigint;
}

export interface FeeDeps {
  /** The wallet for an address, or undefined when this process has no key for it. */
  walletFor: (address: string) => ReceiptReader | undefined;
  /** False on the fake chain, where a fee is zero and there is nothing to ask. */
  settles: boolean;
  /** Writes the chain's figure back to the ledger record. */
  correct?: (key: string, feeWei: bigint) => void;
  /** Told whenever the chain disagrees with what was recorded. */
  onDrift?: (drift: { key: string; from: string; recordedWei: bigint; chainWei: bigint }) => void;
  /** Told when the chain could not be asked, so the recorded figure stands. */
  onUnread?: (key: string, reason: string) => void;
}

export interface FeeMovement {
  address: string;
  amountWei: bigint;
}

/**
 * The fee each applied transfer cost, from the chain where it can be asked.
 *
 * One movement per transfer rather than one per wallet, because that is what
 * reconciliation sums and because a wallet can send twice in a round. A
 * transfer with no hash, on a chain that does not settle, or whose receipt
 * cannot be read keeps the figure the ledger holds: an unreadable receipt is a
 * reason to keep the number that was written down, not to invent one.
 */
export async function feesFromChain(transfers: readonly AppliedTransfer[], deps: FeeDeps): Promise<FeeMovement[]> {
  const movements: FeeMovement[] = [];
  for (const transfer of transfers) {
    const recordedWei = transfer.feeWei ?? 0n;
    if (!deps.settles || transfer.txHash === undefined) {
      movements.push({ address: transfer.from, amountWei: recordedWei });
      continue;
    }
    const wallet = deps.walletFor(transfer.from);
    if (wallet === undefined) {
      deps.onUnread?.(transfer.key, "no wallet for the sender in this process");
      movements.push({ address: transfer.from, amountWei: recordedWei });
      continue;
    }
    try {
      const receipt = await wallet.awaitReceipt(transfer.txHash);
      const chainWei = receipt.feeWei;
      if (chainWei !== recordedWei) {
        deps.onDrift?.({ key: transfer.key, from: transfer.from, recordedWei, chainWei });
        deps.correct?.(transfer.key, chainWei);
      }
      movements.push({ address: transfer.from, amountWei: chainWei });
    } catch (e) {
      // The receipt could not be read this time. The recorded figure stands
      // and the check may fail, which is the honest outcome: a fee nobody can
      // confirm is not a fee to reconcile against.
      deps.onUnread?.(transfer.key, e instanceof Error ? e.name : "unknown");
      movements.push({ address: transfer.from, amountWei: recordedWei });
    }
  }
  return movements;
}
