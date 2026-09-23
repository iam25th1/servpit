import { describe, expect, it } from "vitest";
import { loanBeats, loanEvidenceLine, type LoanShape, type RefusalShape } from "./BankPanel";

const loan = (over: Partial<LoanShape> = {}): LoanShape => ({
  agentId: "atlas",
  name: "Atlas",
  asked: 10,
  tappedOut: true,
  amount: 10,
  rateBps: 500,
  reason: "Clean slate, so I will carry you.",
  source: "serv",
  ...over,
});

const refusal = (over: Partial<RefusalShape> = {}): RefusalShape => ({
  agentId: "blaze",
  name: "Blaze",
  asked: 20,
  tappedOut: true,
  reason: "Settle what you owe me first.",
  source: "serv",
  ...over,
});

describe("what a learned lending answer was drawn from", () => {
  it("says the answers behind it and what Marrow did in them", () => {
    expect(loanEvidenceLine("learned", { matches: 9, approved: 6, typicalAmount: 20 })).toBe(
      "Learned from 9 reasoned answers to borrowers like this. Marrow backed 6, usually for 20 chips.",
    );
  });

  it("leaves the amount out when it backed none of them", () => {
    expect(loanEvidenceLine("learned", { matches: 5, approved: 0, typicalAmount: 0 })).toBe(
      "Learned from 5 reasoned answers to borrowers like this. Marrow backed none of them.",
    );
  });

  it("says nothing under a reasoned answer or the fixed lender", () => {
    expect(loanEvidenceLine("serv", { matches: 9, approved: 6, typicalAmount: 20 })).toBeNull();
    expect(loanEvidenceLine("heuristic", { matches: 9, approved: 6, typicalAmount: 20 })).toBeNull();
    expect(loanEvidenceLine("learned", undefined)).toBeNull();
  });

  it("never mentions how any of those loans ended", () => {
    const line = loanEvidenceLine("learned", { matches: 9, approved: 6, typicalAmount: 20 }) ?? "";
    for (const word of ["repaid", "won", "lost", "wrecked", "default"]) expect(line.toLowerCase()).not.toContain(word);
  });
});

describe("the beats carry the working", () => {
  it("puts the evidence under a learned ruling, advance or refusal", () => {
    const beats = loanBeats(
      [loan({ source: "learned", evidence: { matches: 7, approved: 5, typicalAmount: 10 } })],
      [refusal({ source: "learned", evidence: { matches: 6, approved: 1, typicalAmount: 10 } })],
    );
    expect(beats.find((b) => b.kind === "lend")?.evidence).toMatch(/Learned from 7 reasoned answers/);
    expect(beats.find((b) => b.kind === "refuse")?.evidence).toMatch(/Learned from 6 reasoned answers/);
  });

  it("leaves it off a reasoned ruling", () => {
    const beats = loanBeats([loan()], [refusal()]);
    expect(beats.find((b) => b.kind === "lend")?.evidence).toBeNull();
    expect(beats.find((b) => b.kind === "refuse")?.evidence).toBeNull();
  });
});
