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

  it("uses bigint only and refuses a missing balance", () => {
    const input = base();
    delete input.after["0xb"];
    expect(() => reconcile(input)).toThrow(/balance/);
  });
});
