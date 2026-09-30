// The fee the check adds back comes from the chain, not from what was recorded.

import { describe, expect, it, vi } from "vitest";
import { feesFromChain, type AppliedTransfer } from "./fees";

const AGENT = "0x0000000000000000000000000000000000000a11";
const POT = "0x0000000000000000000000000000000000000b22";

const transfer = (over: Partial<AppliedTransfer> = {}): AppliedTransfer => ({
  key: "r-1:flint:entry",
  from: AGENT,
  txHash: "0xfeed",
  feeWei: 138_907_323_886n,
  ...over,
});

const reader = (feeWei: bigint) => ({ awaitReceipt: vi.fn(async () => ({ feeWei })) });

describe("reading a fee again", () => {
  it("uses the chain's figure when it disagrees with the ledger", async () => {
    // The shape that marked 99 live rounds unreconciled: recorded higher than
    // charged, by the L1 part of the fee.
    const chain = reader(132_025_268_374n);
    const drift: unknown[] = [];
    const corrected: Array<[string, bigint]> = [];

    const fees = await feesFromChain([transfer()], {
      walletFor: () => chain,
      settles: true,
      correct: (key, feeWei) => corrected.push([key, feeWei]),
      onDrift: (d) => drift.push(d),
    });

    expect(fees).toEqual([{ address: AGENT, amountWei: 132_025_268_374n }]);
    expect(corrected).toEqual([["r-1:flint:entry", 132_025_268_374n]]);
    expect(drift).toEqual([{ key: "r-1:flint:entry", from: AGENT, recordedWei: 138_907_323_886n, chainWei: 132_025_268_374n }]);
  });

  it("says nothing and corrects nothing when the two agree", async () => {
    const corrected: string[] = [];
    const drift: unknown[] = [];
    const fees = await feesFromChain([transfer({ feeWei: 132_025_268_374n })], {
      walletFor: () => reader(132_025_268_374n),
      settles: true,
      correct: (key) => corrected.push(key),
      onDrift: (d) => drift.push(d),
    });
    expect(fees).toEqual([{ address: AGENT, amountWei: 132_025_268_374n }]);
    expect(corrected).toEqual([]);
    expect(drift).toEqual([]);
  });

  it("keeps the recorded figure when the receipt cannot be read, and says so", async () => {
    const unread: Array<[string, string]> = [];
    const fees = await feesFromChain([transfer()], {
      walletFor: () => ({ awaitReceipt: async () => { throw new Error("The request took too long to respond."); } }),
      settles: true,
      onUnread: (key, reason) => unread.push([key, reason]),
    });
    // Not derived from anything: the number that was written down stands, and
    // the check is allowed to fail on it.
    expect(fees).toEqual([{ address: AGENT, amountWei: 138_907_323_886n }]);
    expect(unread).toEqual([["r-1:flint:entry", "Error"]]);
  });

  it("asks nothing of a chain that does not settle", async () => {
    const chain = reader(5n);
    const fees = await feesFromChain([transfer({ feeWei: 0n })], { walletFor: () => chain, settles: false });
    expect(fees).toEqual([{ address: AGENT, amountWei: 0n }]);
    expect(chain.awaitReceipt).not.toHaveBeenCalled();
  });

  it("keeps the recorded figure for a transfer with no hash", async () => {
    const fees = await feesFromChain([transfer({ txHash: undefined, feeWei: 7n })], { walletFor: () => reader(9n), settles: true });
    expect(fees).toEqual([{ address: AGENT, amountWei: 7n }]);
  });

  it("keeps one movement per transfer, so a wallet that sent twice is counted twice", async () => {
    const fees = await feesFromChain(
      [transfer({ key: "a", txHash: "0xaa" }), transfer({ key: "b", txHash: "0xbb" }), transfer({ key: "c", from: POT, txHash: "0xcc" })],
      { walletFor: () => reader(100n), settles: true },
    );
    expect(fees).toEqual([
      { address: AGENT, amountWei: 100n },
      { address: AGENT, amountWei: 100n },
      { address: POT, amountWei: 100n },
    ]);
  });

  it("keeps the recorded figure when this process has no wallet for the sender", async () => {
    const unread: Array<[string, string]> = [];
    const fees = await feesFromChain([transfer()], { walletFor: () => undefined, settles: true, onUnread: (key, reason) => unread.push([key, reason]) });
    expect(fees).toEqual([{ address: AGENT, amountWei: 138_907_323_886n }]);
    expect(unread[0]?.[1]).toContain("no wallet");
  });
});
