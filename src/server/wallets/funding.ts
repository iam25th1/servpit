// Planning for the fan out. Pure, so the decision of what to send is testable
// without a chain and can be shown to the operator before anything moves.
//
// Idempotency comes from the chain rather than a local record: each wallet is
// topped up to a target, so a wallet already at or above it is skipped and a
// rerun sends nothing. There is no file to get out of step with reality.

import { assertWei } from "../money";

export interface FundingBalance {
  id: string;
  address: string;
  balanceWei: bigint;
}

export interface FundingTransfer {
  id: string;
  address: string;
  balanceWei: bigint;
  amountWei: bigint;
}

export interface FundingPlan {
  funder: FundingBalance;
  transfers: FundingTransfer[];
  /** Wallets already at or above the target. */
  skipped: FundingBalance[];
  totalWei: bigint;
  affordable: boolean;
  shortfallWei: bigint;
}

export function planFunding(funderId: string, balances: readonly FundingBalance[], targetWei: bigint, funderGasReserveWei: bigint): FundingPlan {
  assertWei(targetWei, "targetWei");
  assertWei(funderGasReserveWei, "funderGasReserveWei");
  if (targetWei === 0n) throw new RangeError("targetWei must be greater than zero");

  const funder = balances.find((b) => b.id === funderId);
  if (!funder) throw new RangeError(`funder ${funderId} is not among the wallets`);

  const transfers: FundingTransfer[] = [];
  const skipped: FundingBalance[] = [];
  for (const wallet of balances) {
    if (wallet.id === funderId) continue;
    if (wallet.balanceWei >= targetWei) {
      skipped.push(wallet);
      continue;
    }
    transfers.push({ id: wallet.id, address: wallet.address, balanceWei: wallet.balanceWei, amountWei: targetWei - wallet.balanceWei });
  }

  const totalWei = transfers.reduce((sum, t) => sum + t.amountWei, 0n);
  const needed = totalWei + funderGasReserveWei;
  const affordable = funder.balanceWei >= needed;
  return { funder, transfers, skipped, totalWei, affordable, shortfallWei: affordable ? 0n : needed - funder.balanceWei };
}
