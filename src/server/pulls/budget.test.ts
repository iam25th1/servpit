import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/config/pulls";
import type { StoredRound } from "../round/store";
import { MICRO_CENTS_PER_CENT, budgetState, spentSince } from "./budget";

const NOW = Date.parse("2026-09-22T12:00:00.000Z");

const round = (agoMs: number, microCents: number): StoredRound =>
  ({
    roundId: `r-${agoMs}`,
    seed: "seed",
    createdAt: new Date(NOW - agoMs).toISOString(),
    network: "fake",
    entrants: 24,
    winner: "bot-01",
    potWei: "0",
    rakeWei: "0",
    agents: [],
    reconciled: true,
    servCalls: microCents > 0 ? 6 : 0,
    servMicroCents: microCents,
  }) as StoredRound;

describe("what reasoning has cost", () => {
  it("adds up what the rounds recorded, rather than estimating from a rate", () => {
    const rounds = [round(60_000, 3 * MICRO_CENTS_PER_CENT), round(120_000, 2 * MICRO_CENTS_PER_CENT)];
    expect(spentSince(rounds, NOW - DAY_MS)).toBe(5 * MICRO_CENTS_PER_CENT);
  });

  it("counts a rolling day, so waiting for midnight gives nobody a fresh budget", () => {
    const rounds = [round(DAY_MS + 60_000, 20 * MICRO_CENTS_PER_CENT), round(60_000, 4 * MICRO_CENTS_PER_CENT)];
    expect(spentSince(rounds, NOW - DAY_MS)).toBe(4 * MICRO_CENTS_PER_CENT);
  });

  it("says when the day's allowance is gone", () => {
    const spent = [round(60_000, 25 * MICRO_CENTS_PER_CENT)];
    expect(budgetState(spent, 25, NOW).withinBudget).toBe(false);
    expect(budgetState(spent, 26, NOW).withinBudget).toBe(true);
  });

  it("treats a budget of nothing as nothing to spend", () => {
    expect(budgetState([], 0, NOW).withinBudget).toBe(false);
  });

  it("ignores a round with no timestamp it can read", () => {
    const broken = { ...round(60_000, 9 * MICRO_CENTS_PER_CENT), createdAt: "not a date" } as StoredRound;
    expect(spentSince([broken], NOW - DAY_MS)).toBe(0);
  });
});
