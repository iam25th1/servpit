import { describe, expect, it } from "vitest";
import { planFunding, type FundingBalance } from "./funding";

const b = (id: string, balanceWei: bigint): FundingBalance => ({ id, address: `0x${id.padEnd(40, "0")}`, balanceWei });

describe("planFunding", () => {
  const target = 1_000n;

  it("tops each wallet up to the target and skips the funder itself", () => {
    const plan = planFunding("atlas", [b("atlas", 10_000n), b("blaze", 0n), b("pot", 400n)], target, 0n);
    expect(plan.transfers.map((t) => [t.id, t.amountWei])).toEqual([
      ["blaze", 1_000n],
      ["pot", 600n],
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("is idempotent: a wallet already at or above the target is skipped, so a rerun sends nothing", () => {
    const wallets = [b("atlas", 10_000n), b("blaze", 1_000n), b("pot", 2_500n)];
    const plan = planFunding("atlas", wallets, target, 0n);
    expect(plan.transfers).toEqual([]);
    expect(plan.skipped.map((s) => s.id)).toEqual(["blaze", "pot"]);
    expect(plan.totalWei).toBe(0n);
  });

  it("reports the total to send so the funder can be checked before anything moves", () => {
    const plan = planFunding("atlas", [b("atlas", 10_000n), b("blaze", 0n), b("pot", 250n)], target, 0n);
    expect(plan.totalWei).toBe(1_750n);
  });

  it("refuses when the funder cannot cover the total plus its own gas", () => {
    const plan = planFunding("atlas", [b("atlas", 1_500n), b("blaze", 0n), b("pot", 0n)], target, 200n);
    expect(plan.affordable).toBe(false);
    expect(plan.shortfallWei).toBe(2_000n + 200n - 1_500n);
  });

  it("is affordable when the funder covers the total and the gas", () => {
    const plan = planFunding("atlas", [b("atlas", 2_200n), b("blaze", 0n), b("pot", 0n)], target, 200n);
    expect(plan.affordable).toBe(true);
    expect(plan.shortfallWei).toBe(0n);
  });

  it("refuses a target of zero rather than planning a pointless run", () => {
    expect(() => planFunding("atlas", [b("atlas", 10n)], 0n, 0n)).toThrow(RangeError);
  });

  it("refuses when the funder is not among the wallets", () => {
    expect(() => planFunding("ghost", [b("atlas", 10n)], 100n, 0n)).toThrow(/ghost/);
  });
});
