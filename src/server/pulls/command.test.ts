import { describe, expect, it } from "vitest";
import { parsePullCommand, pullStatusLines } from "./command";
import { DEFAULT_PULL_SETTINGS } from "./settings";

describe("what the operator asked for", () => {
  it("reads nothing as a request to see where things stand", () => {
    expect(parsePullCommand([])).toEqual({ kind: "status" });
    expect(parsePullCommand(["status"])).toEqual({ kind: "status" });
  });

  it("sets each limit on its own, leaving the others alone", () => {
    expect(parsePullCommand(["per-identity", "5"])).toEqual({ kind: "set", settings: { perIdentity: 5 } });
    expect(parsePullCommand(["window", "12"])).toEqual({ kind: "set", settings: { windowHours: 12 } });
    expect(parsePullCommand(["budget", "40"])).toEqual({ kind: "set", settings: { dailyBudgetCents: 40 } });
    expect(parsePullCommand(["per-hour", "9"])).toEqual({ kind: "set", settings: { perHour: 9 } });
  });

  it("takes unlimited as a word rather than as a very large number", () => {
    expect(parsePullCommand(["per-identity", "unlimited"])).toEqual({ kind: "set", settings: { perIdentity: null } });
  });

  it("refuses a value that is not a whole number in range, rather than writing it", () => {
    expect(() => parsePullCommand(["per-identity", "0"])).toThrow(RangeError);
    expect(() => parsePullCommand(["window", "2.5"])).toThrow(RangeError);
    expect(() => parsePullCommand(["budget", "lots"])).toThrow(RangeError);
    expect(() => parsePullCommand(["per-hour"])).toThrow(RangeError);
  });

  it("allows a budget of nothing, which is a pit that never reasons", () => {
    expect(parsePullCommand(["budget", "0"])).toEqual({ kind: "set", settings: { dailyBudgetCents: 0 } });
  });

  it("refuses a command it does not know", () => {
    expect(() => parsePullCommand(["unlimited-everything"])).toThrow(RangeError);
  });
});

describe("the status", () => {
  const lines = (over: Partial<Parameters<typeof pullStatusLines>[0]> = {}) =>
    pullStatusLines({
      settings: DEFAULT_PULL_SETTINGS,
      budget: { spentMicroCents: 3_000_000, budgetMicroCents: 25_000_000, withinBudget: true },
      startedThisHour: 2,
      reasoningOn: true,
      scheduledReasoning: false,
      pendingHandle: null,
      ...over,
    });

  it("says every limit and where today stands against it", () => {
    const out = lines().join("\n");
    expect(out).toContain("3 pulls every 6 hours");
    expect(out).toContain("6 rounds an hour, 2 started in the last hour");
    expect(out).toContain("3.00 cents of 25.00 cents spent today");
    expect(out).toContain("reasoning is on, scheduled rounds run on instinct");
    expect(out).toContain("waiting: nobody");
  });

  it("says when the budget is spent, and what that means for a pull", () => {
    const out = lines({
      budget: { spentMicroCents: 25_000_000, budgetMicroCents: 25_000_000, withinBudget: false },
      scheduledReasoning: true,
      pendingHandle: "ash",
    }).join("\n");
    expect(out).toContain("run on instinct until it rolls off");
    expect(out).toContain("ash is waiting");
  });

  it("says unlimited when the operator has lifted the per browser limit", () => {
    expect(lines({ settings: { ...DEFAULT_PULL_SETTINGS, perIdentity: null } }).join("\n")).toContain("per browser: unlimited");
  });
});
