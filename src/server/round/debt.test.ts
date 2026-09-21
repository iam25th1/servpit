import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("a wreck record has to reconcile with itself", () => {
  it("counts what this identity borrowed, never what the seat ever borrowed", () => {
    // A wallet outlives its occupants. Counting the ledger's loan records
    // would credit a replacement with the borrowings of the agent it
    // replaced, and a record that says borrowed 10 beside a principal of 30
    // is a record that contradicts itself.
    const { s } = store();
    s.addLoan("atlas", "atlas-1", 200n, 1_000);
    s.addLoan("atlas", "atlas-1", 100n, 1_000);
    const first = s.get("atlas", "atlas-1");
    expect(first.borrowedWei).toBe(300n);
    expect(first.loanCount).toBe(2);

    s.clear("atlas", "atlas-2", "r-9");
    const second = s.get("atlas", "atlas-2");
    expect(second.borrowedWei).toBe(0n);
    expect(second.loanCount).toBe(0);
  });

  it("never shows principal above what was borrowed", () => {
    const { s } = store();
    s.addLoan("atlas", "atlas-1", 200n, 1_000);
    s.accrue("atlas", "atlas-1", "r-1");
    s.settle("atlas", "atlas-1", 50n, 20n);
    const d = s.get("atlas", "atlas-1");
    // Repayment reduces principal and leaves the borrowing history alone,
    // which is what makes the two comparable at all.
    expect(d.principalWei).toBe(150n);
    expect(d.borrowedWei).toBe(200n);
    expect(d.principalWei).toBeLessThanOrEqual(d.borrowedWei);
  });

  it("reads an older file that predates the borrowing counters", () => {
    const { s, file } = store();
    s.addLoan("atlas", "atlas-1", 200n, 1_000);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    delete raw.debts.atlas.borrowedWei;
    delete raw.debts.atlas.loanCount;
    writeFileSync(file, JSON.stringify(raw));
    // Principal is the best available answer for what was borrowed, and it
    // is never above it.
    const reopened = new DebtStore(file);
    expect(reopened.get("atlas", "atlas-1").borrowedWei).toBe(200n);
  });
});

describe("two readers of the same file", () => {
  // The plan route and the settle route each build their own context in one
  // process, so two stores point at one file. The reader has to see what the
  // writer wrote, or the panel shows a loan book that was settled minutes ago.
  it("sees a loan another store recorded", () => {
    const { s: writer, file } = store();
    const reader = new DebtStore(file);
    expect(totalOwed(reader.get("atlas", "atlas-1"))).toBe(0n);
    writer.addLoan("atlas", "atlas-1", 500n, 500);
    expect(totalOwed(reader.get("atlas", "atlas-1"))).toBe(500n);
  });

  it("sees a seat handed on, so it stops naming the dead occupant", () => {
    const { s: writer, file } = store();
    const reader = new DebtStore(file);
    writer.addLoan("atlas", "atlas-1", 500n, 500);
    expect(reader.currentIdentity("atlas")).toBe("atlas-1");
    writer.clear("atlas", "atlas-2", "r-1");
    expect(reader.currentIdentity("atlas")).toBe("atlas-2");
    expect(totalOwed(reader.get("atlas", "atlas-2"))).toBe(0n);
  });

  it("shows the other store's debts in the list the operator reads", () => {
    const { s: writer, file } = store();
    const reader = new DebtStore(file);
    writer.addLoan("blaze", "blaze-1", 300n, 500);
    expect(reader.all().map((d) => d.walletId)).toEqual(["blaze"]);
  });

  it("does not reread a file that has not changed", () => {
    const { s, file } = store();
    s.addLoan("atlas", "atlas-1", 500n, 500);
    const before = readFileSync(file, "utf8");
    expect(totalOwed(s.get("atlas", "atlas-1"))).toBe(500n);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

describe("what an identity has paid back", () => {
  // The lender is told this when it decides. It was a zero in the prompt, so
  // an agent that had repaid every chip looked like one that never had.
  it("counts principal and interest as they are repaid", () => {
    const { s } = store();
    s.addLoan("atlas", "atlas-1", 100n, 2_000);
    s.accrue("atlas", "atlas-1", "r-1");
    expect(s.get("atlas", "atlas-1").repaidWei).toBe(0n);
    s.settle("atlas", "atlas-1", 60n, 20n);
    expect(s.get("atlas", "atlas-1").repaidWei).toBe(80n);
    s.settle("atlas", "atlas-1", 40n, 0n);
    expect(s.get("atlas", "atlas-1").repaidWei).toBe(120n);
  });

  it("starts the next occupant of a seat at nothing", () => {
    const { s } = store();
    s.addLoan("atlas", "atlas-1", 100n, 500);
    s.settle("atlas", "atlas-1", 100n, 0n);
    expect(s.get("atlas", "atlas-1").repaidWei).toBe(100n);
    s.clear("atlas", "atlas-2", "r-2", "onyx");
    expect(s.get("atlas", "atlas-2").repaidWei).toBe(0n);
  });

  it("survives a reload, because the next round reads it from the file", () => {
    const { s, file } = store();
    s.addLoan("atlas", "atlas-1", 100n, 500);
    s.settle("atlas", "atlas-1", 100n, 0n);
    expect(new DebtStore(file).get("atlas", "atlas-1").repaidWei).toBe(100n);
  });
});
