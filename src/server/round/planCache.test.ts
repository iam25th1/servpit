import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN_TTL_MS, PlanCache } from "./planCache";
import type { RoundPlan } from "./flow";

const plan = (roundId: string): RoundPlan => ({ roundId, seed: "s", stakeWei: 100n, decisions: [], snapshots: [], entering: [], bots: [], entrants: [], servCalls: 6, guardRefusals: 0, rejections: [] });

describe("PlanCache", () => {
  it("returns the plan a round was quoted with", () => {
    const c = new PlanCache();
    c.put(plan("r-1"));
    expect(c.get("r-1")?.roundId).toBe("r-1");
  });

  it("misses on a round it never quoted, so the caller re-plans rather than guessing", () => {
    expect(new PlanCache().get("r-unknown")).toBeUndefined();
  });

  it("expires a plan rather than settling against stale balances", () => {
    let t = 0;
    const c = new PlanCache({ ttlMs: 1000, now: () => t });
    c.put(plan("r-1"));
    t = 999;
    expect(c.get("r-1")).toBeDefined();
    t = 1001;
    expect(c.get("r-1")).toBeUndefined();
  });

  it("drops an expired entry instead of holding it forever", () => {
    let t = 0;
    const c = new PlanCache({ ttlMs: 10, now: () => t });
    c.put(plan("r-1"));
    t = 100;
    c.get("r-1");
    expect(c.size).toBe(0);
  });

  it("evicts the oldest once it is full, so a long session cannot grow without bound", () => {
    const c = new PlanCache({ max: 3 });
    for (const id of ["a", "b", "c", "d"]) c.put(plan(id));
    expect(c.size).toBe(3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("d")).toBeDefined();
  });

  it("refreshing a plan moves it to the back of the eviction queue", () => {
    const c = new PlanCache({ max: 2 });
    c.put(plan("a"));
    c.put(plan("b"));
    c.put(plan("a"));
    c.put(plan("c"));
    expect(c.get("a")).toBeDefined();
    expect(c.get("b")).toBeUndefined();
  });

  it("holds a plan long enough to pull the lever", () => {
    expect(DEFAULT_PLAN_TTL_MS).toBeGreaterThanOrEqual(60_000);
  });
});
