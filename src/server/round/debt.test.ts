import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DebtStore, totalOwed } from "./debt";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const store = (): { s: DebtStore; file: string } => {
  dir = mkdtempSync(join(tmpdir(), "servpit-debt-"));
  const file = join(dir, "debts.json");
  return { s: new DebtStore(file), file };
};

describe("what a seat's occupant owes", () => {
  it("starts at nothing, as generation one", () => {
    const { s } = store();
    expect(s.currentIdentity("atlas")).toBe("atlas-1");
    const d = s.get("atlas", "atlas-1");
    expect(totalOwed(d)).toBe(0n);
  });

  it("carries a loan at its rate", () => {
    const { s } = store();
    const d = s.addLoan("atlas", "atlas-1", 200n, 1_200);
    expect(d.principalWei).toBe(200n);
    expect(d.rateBps).toBe(1_200);
    expect(s.addLoan("atlas", "atlas-1", 50n, 1_500).principalWei).toBe(250n);
  });

  it("refuses a rate that is not basis points", () => {
    const { s } = store();
    expect(() => s.addLoan("atlas", "atlas-1", 10n, 10_001)).toThrow(/basis points/);
    expect(() => s.addLoan("atlas", "atlas-1", -1n, 500)).toThrow(/non negative/);
  });
});

describe("interest", () => {
  it("charges a share of principal, not of what is already owed", () => {
    const { s } = store();
    s.addLoan("atlas", "atlas-1", 200n, 1_000);
    expect(s.accrue("atlas", "atlas-1", "r-1").chargedWei).toBe(20n);
    expect(s.accrue("atlas", "atlas-1", "r-2").chargedWei).toBe(20n);
    // Simple, not compound: still twenty, on the same two hundred.
    const d = s.get("atlas", "atlas-1");
    expect(d.interestWei).toBe(40n);
    expect(d.principalWei).toBe(200n);
  });

  it("charges once per round, however many times the round is settled", () => {
    const { s } = store();
    s.addLoan("atlas", "atlas-1", 200n, 1_000);
    expect(s.accrue("atlas", "atlas-1", "r-1").chargedWei).toBe(20n);
    expect(s.accrue("atlas", "atlas-1", "r-1").chargedWei).toBe(0n);
    expect(s.accrue("atlas", "atlas-1", "r-1").chargedWei).toBe(0n);
    expect(s.get("atlas", "atlas-1").interestWei).toBe(20n);
  });

  it("charges nothing on no principal", () => {
    const { s } = store();
    expect(s.accrue("atlas", "atlas-1", "r-1").chargedWei).toBe(0n);
  });

  it("floors, so an agent is never overcharged by a wei", () => {
    const { s } = store();
    s.addLoan("atlas", "atlas-1", 9n, 1_000);
    expect(s.accrue("atlas", "atlas-1", "r-1").chargedWei).toBe(0n);
  });
});

describe("repayment", () => {
  it("reduces what the store holds by exactly what was paid", () => {
    const { s } = store();
    s.addLoan("atlas", "atlas-1", 200n, 1_000);
    s.accrue("atlas", "atlas-1", "r-1");
    const after = s.settle("atlas", "atlas-1", 50n, 20n);
    expect(after.interestWei).toBe(0n);
    expect(after.principalWei).toBe(150n);
  });

  it("refuses to repay more than is owed", () => {
    const { s } = store();
    s.addLoan("atlas", "atlas-1", 200n, 1_000);
    expect(() => s.settle("atlas", "atlas-1", 201n, 0n)).toThrow(/more than is owed/);
    expect(() => s.settle("atlas", "atlas-1", 0n, 1n)).toThrow(/more than is owed/);
  });
});

describe("a debt dies with the agent that owed it", () => {
  it("hands the seat to a new identity with nothing on it", () => {
    const { s } = store();
    s.addLoan("atlas", "atlas-1", 200n, 1_000);
    s.accrue("atlas", "atlas-1", "r-1");
    expect(totalOwed(s.get("atlas", "atlas-1"))).toBe(220n);

    s.clear("atlas", "atlas-2");
    expect(s.currentIdentity("atlas")).toBe("atlas-2");
    expect(totalOwed(s.get("atlas", "atlas-2"))).toBe(0n);
  });

  it("does not hand a dead agent's debt to whoever asks with the wrong identity", () => {
    // The seat outlives its occupants. A debt stamped with one identity is
    // not another's to carry, even in the same wallet.
    const { s } = store();
    s.addLoan("atlas", "atlas-1", 200n, 1_000);
    expect(totalOwed(s.get("atlas", "atlas-9"))).toBe(0n);
  });
});

describe("it survives a restart", () => {
  it("reads principal, interest, rate and the accrual stamp back off disk", () => {
    const { s, file } = store();
    s.addLoan("atlas", "atlas-1", 200n, 1_200);
    s.accrue("atlas", "atlas-1", "r-7");

    const reopened = new DebtStore(file);
    const d = reopened.get("atlas", "atlas-1");
    expect(d.principalWei).toBe(200n);
    expect(d.interestWei).toBe(24n);
    expect(d.rateBps).toBe(1_200);
    // And it still will not charge twice for the round it already charged.
    expect(reopened.accrue("atlas", "atlas-1", "r-7").chargedWei).toBe(0n);
    expect(JSON.parse(readFileSync(file, "utf8")).debts.atlas.principalWei).toBe("200");
  });
});
