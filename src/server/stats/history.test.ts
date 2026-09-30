// How far back the stores reach, and which rounds can still be spoken for.

import { describe, expect, it } from "vitest";
import { classOf, classSplit, covers, lengthOf, lifetimeRounds, spanOf } from "./history";
import type { Stores } from "./read";

const bare = (over: Partial<Stores> = {}): Stores => ({
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
  ...over,
});

const AT = (day: number): string => `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`;

describe("spans", () => {
  it("takes the oldest and newest of what it is given, ignoring what has no date", () => {
    expect(spanOf([Date.parse(AT(21)), null, Date.parse(AT(30)), Number.NaN])).toEqual({ oldest: Date.parse(AT(21)), newest: Date.parse(AT(30)) });
    expect(spanOf([])).toEqual({ oldest: null, newest: null });
  });

  it("says hours under two days and days above", () => {
    expect(lengthOf({ oldest: 0, newest: 3_600_000 })).toBe("1.0 hours");
    expect(lengthOf({ oldest: 0, newest: 5 * 86_400_000 })).toBe("5.0 days");
    expect(lengthOf({ oldest: null, newest: null })).toBe("no dates on file");
  });

  it("says where a figure came from and what it covers", () => {
    expect(covers("the ledger", { oldest: Date.parse(AT(21)), newest: Date.parse(AT(30)) })).toBe("the ledger, 2026-09-21 to 2026-09-30, 9.0 days");
    // With nothing to date, the source alone, rather than an invented period.
    expect(covers("the boards", { oldest: null, newest: null })).toBe("the boards");
  });
});

describe("classing a round", () => {
  it("is reasoned when any decision came from the model", () => {
    expect(classOf(["heuristic", "serv", "heuristic"])).toBe("reasoned");
  });

  it("is learned when none did and any was drawn from what it learned", () => {
    expect(classOf(["heuristic", "learned"])).toBe("learned");
  });

  it("is instinct when every decision was the fixed rule", () => {
    expect(classOf(["heuristic", "heuristic"])).toBe("instinct");
  });

  it("is nothing at all when there are no decisions to read", () => {
    expect(classOf([])).toBeNull();
    expect(classOf([undefined, undefined])).toBeNull();
  });
});

describe("reaching back over the whole history", () => {
  it("names every round any store mentions, and dates it where a store can", () => {
    const life = lifetimeRounds(
      bare({
        rounds: [{ roundId: "r-window", createdAt: AT(30), agents: [{ source: "heuristic" }] }],
        transfers: [
          { roundId: "r-window", createdAt: AT(30), kind: "entry" },
          { roundId: "r-old", createdAt: AT(22), kind: "entry" },
        ],
        wrecks: [{ roundId: "r-older", at: AT(21) }],
        pulls: [{ k: "started", roundId: "r-pulled", at: AT(23) }],
        picks: [{ k: "pick", roundId: "r-backed", at: AT(24) }],
      }),
    );

    expect([...life.ids].sort()).toEqual(["r-backed", "r-old", "r-older", "r-pulled", "r-window"]);
    expect(life.dated.get("r-older")).toBe(Date.parse(AT(21)));
    expect(life.span).toEqual({ oldest: Date.parse(AT(21)), newest: Date.parse(AT(30)) });
    expect(life.bySource).toEqual({ "the round store": 1, "the ledger": 1, "the wreck store": 1, "the pull log": 1, "the pick log": 1 });
    expect([...life.pulled]).toEqual(["r-pulled"]);
  });

  it("classes a round from a quoted plan when its own record has aged out", () => {
    const life = lifetimeRounds(
      bare({
        rounds: [{ roundId: "r-window", createdAt: AT(30), agents: [{ source: "heuristic" }] }],
        plans: [{ quotedAt: AT(21), plan: { roundId: "r-gone", decisions: [{ source: "serv" }, { source: "heuristic" }] } }],
      }),
    );
    expect(life.classified.get("r-gone")).toBe("reasoned");
    expect(classSplit(life)).toEqual({ reasoned: 1, learned: 0, instinct: 1, unclassified: 0 });
  });

  it("counts a round nobody can speak for as unclassified, never as instinct", () => {
    const life = lifetimeRounds(
      bare({
        rounds: [{ roundId: "r-window", createdAt: AT(30), agents: [{ source: "serv", situation: {} }] }],
        // Two rounds the ledger remembers and nothing else does.
        transfers: [
          { roundId: "r-gone-1", createdAt: AT(22), kind: "entry" },
          { roundId: "r-gone-2", createdAt: AT(23), kind: "payout" },
        ],
      }),
    );
    const split = classSplit(life);
    expect(split).toEqual({ reasoned: 1, learned: 0, instinct: 0, unclassified: 2 });
    // The point of the whole exercise: they are not swept into instinct.
    expect(split.instinct).toBe(0);
  });

  it("prefers the round record's own verdict to a plan's, when both exist", () => {
    const life = lifetimeRounds(
      bare({
        rounds: [{ roundId: "r-1", createdAt: AT(30), agents: [{ source: "learned" }] }],
        plans: [{ quotedAt: AT(30), plan: { roundId: "r-1", decisions: [{ source: "serv" }] } }],
      }),
    );
    expect(life.classified.get("r-1")).toBe("learned");
  });

  it("finds nothing in empty stores rather than inventing a round", () => {
    const life = lifetimeRounds(bare());
    expect(life.ids.size).toBe(0);
    expect(classSplit(life)).toEqual({ reasoned: 0, learned: 0, instinct: 0, unclassified: 0 });
  });
});
