import { describe, expect, it } from "vitest";
import type { Stores } from "@/server/stats/read";
import { dollars, measuredRate, microCentsFromDollars, newRounds, planRun, reasonedSoFar, shouldStop, UNREASONED_IN_A_ROW_LIMIT } from "./reasonTo";

function stores(partial: Partial<Stores>): Stores {
  return {
    network: "fake",
    dataDir: "/nowhere",
    rounds: null,
    transfers: null,
    wrecks: null,
    debts: null,
    rollover: null,
    arena: null,
    plans: null,
    picks: null,
    pulls: null,
    fighters: null,
    careers: null,
    leaderboard: null,
    summaries: null,
    ...partial,
  };
}

const serv = [{ source: "serv" }, { source: "heuristic" }];
const instinct = [{ source: "heuristic" }, { source: "heuristic" }];

describe("reasonedSoFar", () => {
  it("counts like npm run stats: a round reasons when any agent got a model's answer, summaries included", () => {
    const s = stores({
      rounds: [
        { roundId: "r-a", createdAt: "2026-10-01T00:00:00Z", agents: serv },
        { roundId: "r-b", createdAt: "2026-10-01T00:01:00Z", agents: instinct },
      ],
      summaries: [
        { k: "round", roundId: "r-c", answers: "reasoned" },
        { k: "round", roundId: "r-a", answers: "reasoned" },
        { k: "round", roundId: "r-d", answers: "instinct" },
      ],
    });
    expect(reasonedSoFar(s)).toBe(2);
  });
});

describe("measuredRate", () => {
  it("averages each reasoned round's own cost and leaves out meter totals and backfills", () => {
    const s = stores({
      rounds: [
        { roundId: "r-a", agents: serv, servCalls: 7, servMicroCents: 2_000_000, servTokensIn: 900 },
        // A meter total: no token counts, so not this round's own figure.
        { roundId: "r-b", agents: serv, servCalls: 7, servMicroCents: 90_000_000 },
        // Instinct costs nothing and prices nothing.
        { roundId: "r-c", agents: instinct, servCalls: 0, servMicroCents: 0, servTokensIn: 0 },
      ],
      summaries: [
        { k: "round", roundId: "r-d", answers: "reasoned", servCalls: 6, servMicroCents: 2_200_000 },
        { k: "round", roundId: "r-e", answers: "reasoned", servCalls: 6, servMicroCents: 5_000_000, backfilled: true },
        { k: "round", roundId: "r-a", answers: "reasoned", servCalls: 7, servMicroCents: 2_000_000 },
      ],
    });
    expect(measuredRate(s)).toEqual({ perRoundMicroCents: 2_100_000, rounds: 2, calls: 13 });
  });

  it("is null when nothing on file has a cost of its own", () => {
    expect(measuredRate(stores({ rounds: [{ roundId: "r-a", agents: instinct }] }))).toBeNull();
  });
});

describe("planRun", () => {
  it("prices the rounds still needed and caps at twice that", () => {
    const plan = planRun({ target: 10, have: 4, perRoundMicroCents: 2_090_000, budgetLeftMicroCents: 25_000_000 });
    expect(plan.need).toBe(6);
    expect(plan.estimateMicroCents).toBe(12_540_000);
    expect(plan.capMicroCents).toBe(25_080_000);
    expect(plan.budgetCovers).toBe(11);
    expect(dollars(plan.estimateMicroCents!)).toBe("$0.1254");
  });

  it("needs nothing once the count is reached, and takes a given cap over its own", () => {
    expect(planRun({ target: 4, have: 6, perRoundMicroCents: 1, budgetLeftMicroCents: 0 }).need).toBe(0);
    expect(planRun({ target: 10, have: 4, perRoundMicroCents: 2_000_000, capMicroCents: 5_000_000, budgetLeftMicroCents: 0 }).capMicroCents).toBe(5_000_000);
  });

  it("has no estimate and no cap when there is nothing to price by", () => {
    const plan = planRun({ target: 10, have: 4, perRoundMicroCents: null, budgetLeftMicroCents: 25_000_000 });
    expect(plan.estimateMicroCents).toBeNull();
    expect(plan.capMicroCents).toBeNull();
    expect(plan.budgetCovers).toBeNull();
  });
});

describe("microCentsFromDollars", () => {
  it("reads a dollar amount and refuses nonsense", () => {
    expect(microCentsFromDollars("0.0209")).toBe(2_090_000);
    expect(microCentsFromDollars("$0.50")).toBe(50_000_000);
    expect(() => microCentsFromDollars("0")).toThrow(RangeError);
    expect(() => microCentsFromDollars("lots")).toThrow(RangeError);
    expect(() => microCentsFromDollars("500")).toThrow(RangeError);
  });
});

describe("newRounds", () => {
  it("returns rounds settled since the start, oldest first, once each", () => {
    const since = Date.parse("2026-10-13T08:00:00Z");
    const s = stores({
      rounds: [
        { roundId: "r-old", createdAt: "2026-10-13T07:59:00Z", agents: serv },
        { roundId: "r-2", createdAt: "2026-10-13T08:02:00Z", agents: instinct, servCalls: 0, servMicroCents: 0, servTokensIn: 0 },
        { roundId: "r-1", createdAt: "2026-10-13T08:01:00Z", agents: serv, servCalls: 7, servMicroCents: 2_000_000, servTokensIn: 800 },
      ],
    });
    const seen = newRounds(s, since, new Set());
    expect(seen.map((r) => r.roundId)).toEqual(["r-1", "r-2"]);
    expect(seen[0]).toEqual({ roundId: "r-1", reasoned: true, calls: 7, microCents: 2_000_000 });
    expect(newRounds(s, since, new Set(["r-1"])).map((r) => r.roundId)).toEqual(["r-2"]);
  });
});

describe("shouldStop", () => {
  const base = { reasoned: 0, need: 6, spentMicroCents: 0, capMicroCents: 10_000_000, unreasonedInARow: 0 };
  it("stops at the count, at the cap, or when rounds stop reasoning", () => {
    expect(shouldStop(base)).toEqual({ stop: false });
    expect(shouldStop({ ...base, reasoned: 6 })).toEqual({ stop: true, why: "target" });
    expect(shouldStop({ ...base, spentMicroCents: 10_000_000 })).toEqual({ stop: true, why: "cap" });
    expect(shouldStop({ ...base, unreasonedInARow: UNREASONED_IN_A_ROW_LIMIT })).toEqual({ stop: true, why: "unreasoned" });
    expect(shouldStop({ ...base, unreasonedInARow: UNREASONED_IN_A_ROW_LIMIT - 1 })).toEqual({ stop: false });
  });
});
