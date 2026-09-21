import { describe, expect, it } from "vitest";
import { reconcile, type ReconcileInput } from "./reconcile";

const base = (): ReconcileInput => ({
  potAddress: "0xpot",
  before: { "0xpot": 10_000n, "0xa": 1_000n, "0xb": 1_000n, "0xc": 1_000n },
  after: { "0xpot": 10_000n + 300n - 500n, "0xa": 1_000n - 100n + 500n, "0xb": 1_000n - 100n, "0xc": 1_000n - 100n },
  entries: [
    { address: "0xa", amountWei: 100n },
    { address: "0xb", amountWei: 100n },
    { address: "0xc", amountWei: 100n },
  ],
  payouts: [{ address: "0xa", amountWei: 500n }],
  houseContributionWei: 200n,
  rakeWei: 0n,
});

describe("reconcile", () => {
  it("holds when every on chain delta matches the transfers and entries plus house share minus rake equal payouts", () => {
    const r = reconcile(base());
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.checks.map((c) => c.name)).toContain("pot delta");
    expect(r.checks.map((c) => c.name)).toContain("conservation");
  });

  it("fails when a payout did not land on chain", () => {
    const input = base();
    input.after["0xa"] = 1_000n - 100n;
    input.after["0xpot"] = 10_000n + 300n;
    const r = reconcile(input);
    expect(r.ok).toBe(false);
    const bad = r.checks.filter((c) => !c.ok).map((c) => c.name);
    expect(bad).toContain("wallet 0xa delta");
    expect(bad).toContain("pot delta");
  });

  it("fails when the pot paid out more than entries plus house share minus rake", () => {
    const input = base();
    input.payouts = [{ address: "0xa", amountWei: 600n }];
    input.after["0xa"] = 1_000n - 100n + 600n;
    input.after["0xpot"] = 10_000n + 300n - 600n;
    const r = reconcile(input);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "conservation")?.ok).toBe(false);
  });

  it("accounts for a house win: nothing leaves the pot", () => {
    const input = base();
    input.payouts = [];
    input.after = { "0xpot": 10_000n + 300n, "0xa": 900n, "0xb": 900n, "0xc": 900n };
    input.houseContributionWei = 200n;
    expect(reconcile(input).ok).toBe(true);
  });

  it("holds for a replay that applied nothing: zero deltas, conservation unchanged", () => {
    const input = base();
    input.after = { ...input.before };
    input.appliedEntries = [];
    input.appliedPayouts = [];
    const r = reconcile(input);
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.name === "pot delta")?.expected).toBe("0");
  });

  it("uses bigint only and refuses a missing balance", () => {
    const input = base();
    delete input.after["0xb"];
    expect(() => reconcile(input)).toThrow(/balance/);
  });
});

/**
 * Gas. Until the phase 5 viem swap the agents were CDP smart wallets and the
 * paymaster paid their fees, so a wallet's raw balance delta was exactly its
 * stake movement. Plain accounts pay their own gas, so the raw delta now
 * carries a fee the stake accounting knows nothing about.
 *
 * The fee comes from each transaction's receipt, never from the gap between
 * what was expected and what was seen. Deriving it from the gap would make
 * the check pass by construction.
 */
describe("reconcile with self funded gas", () => {
  // The real numbers from the first settled round on Base Sepolia: 21000 gas
  // at 0.006 gwei is 126000000000 wei of L2 fee, plus an L1 data fee that is
  // not the same for every transaction in the round.
  const FEE_A = 132_252_136_428n;
  const FEE_B = 131_698_658_288n;

  /** What an agent wallet actually holds after the fan out: 0.0001 ETH. */
  const FUNDED = 100_000_000_000_000n;

  const withGas = (): ReconcileInput => {
    const input = base();
    input.payouts = [];
    input.before = { "0xpot": FUNDED, "0xa": FUNDED, "0xb": FUNDED, "0xc": FUNDED };
    input.after = {
      "0xpot": FUNDED + 300n,
      "0xa": FUNDED - 100n - FEE_A,
      "0xb": FUNDED - 100n - FEE_B,
      "0xc": FUNDED - 100n - FEE_A,
    };
    input.feesWei = [
      { address: "0xa", amountWei: FEE_A },
      { address: "0xb", amountWei: FEE_B },
      { address: "0xc", amountWei: FEE_A },
    ];
    return input;
  };

  it("passes when the only difference from the stake is the gas each wallet actually paid", () => {
    const r = reconcile(withGas());
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("fails when the stake is genuinely wrong, even with the gas accounted for", () => {
    // A wallet that paid 150 instead of the 100 the ledger recorded. The gas
    // is correct and subtracted; the stake is not, and the check must say so.
    const input = withGas();
    input.after["0xb"] = FUNDED - 150n - FEE_B;
    const r = reconcile(input);
    expect(r.ok).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["wallet 0xb delta"]);
    const failed = r.checks.find((c) => c.name === "wallet 0xb delta")!;
    expect(failed.expected).toBe((-100n).toString());
    expect(failed.actual).toBe((-150n).toString());
  });

  it("fails when a wallet moved nothing at all but the ledger says it entered", () => {
    const input = withGas();
    input.after["0xc"] = FUNDED;
    const r = reconcile(input);
    expect(r.ok).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.name)).toContain("wallet 0xc delta");
  });

  it("fails when the gas claimed is not the gas that was paid", () => {
    // The fee comes from a receipt. If a wrong fee were supplied, the delta
    // stops adding up rather than being absorbed.
    const input = withGas();
    input.feesWei = input.feesWei!.map((f) => (f.address === "0xa" ? { ...f, amountWei: FEE_A + 1n } : f));
    const r = reconcile(input);
    expect(r.ok).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["wallet 0xa delta"]);
  });

  it("still fails a wallet whose fee was never reported, rather than letting it through", () => {
    const input = withGas();
    input.feesWei = input.feesWei!.filter((f) => f.address !== "0xa");
    const r = reconcile(input);
    expect(r.ok).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["wallet 0xa delta"]);
  });

  it("charges no gas to the pot, which receives and does not send", () => {
    // The pot's delta was already correct, because collecting an entry costs
    // the sender's gas and not the recipient's.
    const r = reconcile(withGas());
    expect(r.checks.find((c) => c.name === "pot delta")!.ok).toBe(true);
  });

  it("behaves exactly as before when no fees are supplied, so the fake chain is unaffected", () => {
    const r = reconcile(base());
    expect(r.ok).toBe(true);
  });

  it("refuses a negative fee rather than treating it as a credit", () => {
    const input = withGas();
    input.feesWei = [{ address: "0xa", amountWei: -1n }];
    expect(() => reconcile(input)).toThrow(RangeError);
  });
});
