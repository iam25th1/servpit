import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SERV } from "@/config/serv";
import { CostMeter, ServClient, type ChatTransport } from "../serv/client";
import { BANK_DECISION_SCHEMA, BANK_NAME, buildBankPrompt, decideLoan, heuristicLoan, lendableChips, validateLoanDecision, type LoanBounds, type LoanRequest } from "./bank";
import { UNSUPPORTED_SCHEMA_KEYWORDS, schemaKeywords } from "./decide";

const bounds = (patch: Partial<LoanBounds> = {}): LoanBounds => ({
  treasuryChips: 1_000,
  maxLoanChips: 30,
  debtCeilingChips: 40,
  minRateBps: 500,
  maxRateBps: 3_000,
  ...patch,
});

const request = (patch: Partial<LoanRequest> = {}): LoanRequest => ({
  record: { agentId: "blaze", name: "Blaze", balanceChips: 10, debtChips: 0, roundsPlayed: 4, wins: 1, repaidChips: 0 },
  stakeChips: 30,
  shortfallChips: 20,
  ...patch,
});

const answer = (body: Record<string, unknown>): string => JSON.stringify(body);
const good = { approve: true, amount: 20, rateBps: 1_000, reason: "You are good for it, so far." };

describe("the schema SERV will actually accept", () => {
  it("expresses no numeric range, because SERV rejects those keywords", () => {
    const used = schemaKeywords(BANK_DECISION_SCHEMA);
    for (const banned of UNSUPPORTED_SCHEMA_KEYWORDS) expect([...used], banned).not.toContain(banned);
  });

  it("asks for exactly the four keys the validator checks", () => {
    expect(BANK_DECISION_SCHEMA.required).toEqual(["approve", "amount", "rateBps", "reason"]);
    expect(BANK_DECISION_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("what the bank may lend, from figures read off the chain", () => {
  it("takes the tightest of the shortfall, the loan limit, the treasury and the ceiling", () => {
    expect(lendableChips(request({ shortfallChips: 5 }), bounds())).toBe(5);
    expect(lendableChips(request(), bounds({ maxLoanChips: 12 }))).toBe(12);
    expect(lendableChips(request(), bounds({ treasuryChips: 7 }))).toBe(7);
    // Already owes 35 against a ceiling of 40, so five chips of headroom.
    expect(lendableChips(request({ record: { ...request().record, debtChips: 35 } }), bounds())).toBe(5);
  });

  it("is nothing when the borrower is already at the ceiling", () => {
    expect(lendableChips(request({ record: { ...request().record, debtChips: 40 } }), bounds())).toBe(0);
    expect(lendableChips(request({ record: { ...request().record, debtChips: 99 } }), bounds())).toBe(0);
  });

  it("is nothing when the bank is empty", () => {
    expect(lendableChips(request(), bounds({ treasuryChips: 0 }))).toBe(0);
  });
});

describe("validateLoanDecision", () => {
  it("accepts a well formed approval inside every bound", () => {
    const r = validateLoanDecision(answer(good), request(), bounds());
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.decision).toEqual({ approve: true, amountChips: 20, rateBps: 1_000, reason: "You are good for it, so far." });
  });

  it("refuses an amount above what the bank may lend, whatever it says", () => {
    // The bound is the treasury this process read from the chain, and no
    // answer can talk past it.
    const r = validateLoanDecision(answer({ ...good, amount: 21 }), request(), bounds());
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain("above the 20 chips");
  });

  it("refuses an amount the treasury cannot cover", () => {
    expect(validateLoanDecision(answer({ ...good, amount: 20 }), request(), bounds({ treasuryChips: 5 })).ok).toBe(false);
  });

  it("refuses a loan that would take the borrower past the debt ceiling", () => {
    const atCeiling = request({ record: { ...request().record, debtChips: 38 } });
    // Two chips of headroom, so twenty is refused before it is written.
    expect(validateLoanDecision(answer({ ...good, amount: 20 }), atCeiling, bounds()).ok).toBe(false);
    expect(validateLoanDecision(answer({ ...good, amount: 2 }), atCeiling, bounds()).ok).toBe(true);
  });

  it("refuses a rate outside the range", () => {
    expect(validateLoanDecision(answer({ ...good, rateBps: 499 }), request(), bounds()).ok).toBe(false);
    expect(validateLoanDecision(answer({ ...good, rateBps: 3_001 }), request(), bounds()).ok).toBe(false);
    expect(validateLoanDecision(answer({ ...good, rateBps: 500 }), request(), bounds()).ok).toBe(true);
    expect(validateLoanDecision(answer({ ...good, rateBps: 3_000 }), request(), bounds()).ok).toBe(true);
  });

  it("refuses an amount that is not a whole non negative number of chips", () => {
    for (const amount of [-1, 1.5, Number.NaN, "20"]) {
      expect(validateLoanDecision(answer({ ...good, amount }), request(), bounds()).ok, String(amount)).toBe(false);
    }
  });

  it("requires a refusal to lend nothing, and an approval to lend something", () => {
    expect(validateLoanDecision(answer({ approve: false, amount: 5, rateBps: 500, reason: "No." }), request(), bounds()).ok).toBe(false);
    expect(validateLoanDecision(answer({ ...good, amount: 0 }), request(), bounds()).ok).toBe(false);
    const refusal = validateLoanDecision(answer({ approve: false, amount: 0, rateBps: 500, reason: "Settle up first." }), request(), bounds());
    expect(refusal.ok).toBe(true);
    expect(refusal.ok === true && refusal.decision.amountChips).toBe(0);
  });

  it("refuses anything that is not the four keys", () => {
    expect(validateLoanDecision("not json", request(), bounds()).ok).toBe(false);
    expect(validateLoanDecision("[]", request(), bounds()).ok).toBe(false);
    expect(validateLoanDecision(answer({ approve: true, amount: 20, rateBps: 1_000 }), request(), bounds()).ok).toBe(false);
    expect(validateLoanDecision(answer({ ...good, extra: 1 }), request(), bounds()).ok).toBe(false);
  });

  it("holds the lender to the same plain language as the agents", () => {
    expect(validateLoanDecision(answer({ ...good, reason: "Advancing 20 minor units against posture." }), request(), bounds()).ok).toBe(false);
    expect(validateLoanDecision(answer({ ...good, reason: "Covering 123456 of them." }), request(), bounds()).ok).toBe(false);
    const long = validateLoanDecision(answer({ ...good, reason: Array.from({ length: 25 }, () => "word").join(" ") }), request(), bounds());
    expect(long.ok).toBe(false);
  });
});

describe("the deterministic lender", () => {
  it("lends the most it may to a borrower that owes nothing", () => {
    const d = heuristicLoan(request(), bounds());
    expect(d).toEqual({ approve: true, amountChips: 20, rateBps: 500, reason: "Clean slate, so I will carry you." });
  });

  it("refuses a borrower that already owes, and one it cannot cover", () => {
    expect(heuristicLoan(request({ record: { ...request().record, debtChips: 5 } }), bounds()).approve).toBe(false);
    expect(heuristicLoan(request(), bounds({ treasuryChips: 0 })).approve).toBe(false);
  });
});

describe("decideLoan", () => {
  const transport = (content: string): ChatTransport =>
    ({
      create: vi.fn().mockResolvedValue({
        model: "claude-haiku-4.5",
        choices: [{ index: 0, message: { role: "assistant", content } }, { finish_reason: "stop" }],
        usage: { prompt_tokens: 400, completion_tokens: 40, total_tokens: 440 },
      }),
    }) as unknown as ChatTransport;

  const deps = (t?: ChatTransport) => ({ client: t ? new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, t) : undefined, meter: new CostMeter(DEFAULT_SERV.pricing) });

  it("uses the deterministic lender when SERV is absent", async () => {
    const d = await decideLoan(deps(), request(), bounds());
    expect(d.source).toBe("heuristic");
    expect(d.rejection).toMatch(/not configured/);
  });

  it("takes a valid answer from the model", async () => {
    const d = await decideLoan(deps(transport(answer(good))), request(), bounds());
    expect(d.source).toBe("serv");
    expect(d.decision.amountChips).toBe(20);
  });

  it("treats a model answer outside the bounds as a denial, not a correction", async () => {
    // Every validation failure is a denial. A model that proposes a number
    // outside the bounds has not made a small mistake about a loan.
    const d = await decideLoan(deps(transport(answer({ ...good, amount: 9_999 }))), request(), bounds());
    expect(d.source).toBe("heuristic");
    expect(d.rejection).toContain("above the 20 chips");
  });

  it("falls back rather than failing the round when SERV throws", async () => {
    const broken = { create: vi.fn().mockRejectedValue(new Error("502 upstream")) } as unknown as ChatTransport;
    const d = await decideLoan(deps(broken), request(), bounds());
    expect(d.source).toBe("heuristic");
    expect(d.rejection).toContain("502");
  });
});

describe("the lender's prompt", () => {
  it("names the lender and states every bound in chips", () => {
    const { system, user } = buildBankPrompt(request(), bounds());
    expect(system).toContain(BANK_NAME);
    expect(user).toContain("Blaze wants to put up 30 chips and is 20 short");
    expect(user).toContain("already owes you 0");
    expect(user).toContain("You hold 1000 chips");
    expect(user).toContain("between 500 and 3000 basis points");
  });

  it("tells it the most it may lend, not just the shortfall", () => {
    const { user } = buildBankPrompt(request(), bounds({ treasuryChips: 7 }));
    expect(user).toContain("You may lend at most 7");
  });
});
