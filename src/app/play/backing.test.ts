import { describe, expect, it } from "vitest";
import { backOptions, entrantIdOf, pickOutcome } from "./backing";
import type { ArenaFeedRound } from "./arenaScreens";

const AT = "2026-09-22T00:00:00.000Z";

const round = (extra: Partial<ArenaFeedRound> = {}): ArenaFeedRound => ({
  roundId: "r-1",
  startedAt: AT,
  phase: "backing",
  phases: [{ phase: "backing", at: AT, durationMs: 45_000 }],
  network: "fake",
  backend: "fake",
  entrants: 24,
  bots: 22,
  stakeChips: 10,
  weiPerChip: "1000000000000",
  decisions: [
    { agentId: "atlas", name: "Atlas", face: "Knight", enter: true, stake: 10, reason: "I am in.", source: "serv", balance: 40, debt: 0 },
    { agentId: "vex", name: "Vex", face: "NinjaFire", enter: true, stake: 10, reason: "In.", source: "heuristic", balance: 30, debt: 0 },
    { agentId: "comet", name: "Comet", face: null, enter: false, stake: 0, reason: "Out.", source: "serv", balance: 9, debt: 0 },
  ],
  loans: [],
  refusals: [],
  bank: null,
  entries: [
    { agentId: "atlas", amountWei: "10000000000000", txHash: "0xa", link: null },
    { agentId: "vex", amountWei: "10000000000000", txHash: "0xb", link: null },
  ],
  reels: [
    { entrantId: "agent-atlas", symbols: ["a", "b", "c"], characterId: "Knight", tier: "rare", combo: "none", bonusPct: 0 },
    { entrantId: "agent-vex", symbols: ["d", "e", "f"], characterId: "Bear", tier: "common", combo: "none", bonusPct: 0 },
  ],
  ...extra,
});

describe("who may be backed", () => {
  it("is the agents that paid, with what they drew", () => {
    expect(backOptions(round(), { atlas: 3 })).toEqual([
      { agentId: "atlas", name: "Atlas", face: "Knight", characterId: "Knight", tier: "rare", backers: 3 },
      { agentId: "vex", name: "Vex", face: "NinjaFire", characterId: "Bear", tier: "common", backers: 0 },
    ]);
  });

  it("leaves out an agent that sat the round out, since it is not in the fight", () => {
    expect(backOptions(round(), {}).map((o) => o.agentId)).not.toContain("comet");
  });

  it("draws the row before the reels have landed, with no fighter yet", () => {
    const early = round({ reels: undefined });
    expect(backOptions(early, {})[0]).toMatchObject({ agentId: "atlas", characterId: null, tier: null });
  });

  it("has nothing to draw with no round", () => {
    expect(backOptions(null, {})).toEqual([]);
  });
});

describe("how a call went", () => {
  const settled = (winner: string): ArenaFeedRound => round({ phase: "result", result: { winner } });

  it("pays the base when everybody called it the same way", () => {
    expect(pickOutcome(settled("agent-atlas"), "atlas", { atlas: 4 })).toEqual({ pick: "atlas", won: true, points: 100 });
  });

  it("pays the lone caller the whole field", () => {
    expect(pickOutcome(settled("agent-vex"), "vex", { atlas: 3, vex: 1 })).toEqual({ pick: "vex", won: true, points: 400 });
  });

  it("pays a wrong call nothing", () => {
    expect(pickOutcome(settled("agent-atlas"), "vex", { atlas: 3, vex: 1 })).toEqual({ pick: "vex", won: false, points: 0 });
  });

  it("pays nothing when a house bot took it", () => {
    expect(pickOutcome(settled("bot-07"), "atlas", { atlas: 2 })).toEqual({ pick: "atlas", won: false, points: 0 });
  });

  it("says nothing before the round has a result, which is what a spoiler would be", () => {
    expect(pickOutcome(round(), "atlas", { atlas: 2 })).toBeNull();
    expect(pickOutcome(round({ phase: "fight" }), "atlas", { atlas: 2 })).toBeNull();
  });

  it("says nothing for a viewer who did not back anybody", () => {
    expect(pickOutcome(settled("agent-atlas"), null, { atlas: 2 })).toBeNull();
  });
});

describe("the entrant an agent fights as", () => {
  it("is the id a result names it by", () => {
    expect(entrantIdOf("atlas")).toBe("agent-atlas");
  });
});
