import { describe, expect, it } from "vitest";
import type { ArenaPhase } from "@/server/arena/state";
import type { ArenaFeedRound } from "./arenaScreens";
import { CALL_SEATS, CALL_TERMS, callSeats, callsLine, lastLine, roundRead, seatCall, styleLine } from "./calls";

const AT = "2026-09-22T00:00:00.000Z";

const round = (phase: ArenaPhase, extra: Partial<ArenaFeedRound> = {}): ArenaFeedRound => ({
  roundId: "r-1",
  startedAt: AT,
  phase,
  phases: [{ phase, at: AT }],
  network: "fake",
  backend: "fake",
  entrants: 24,
  bots: 20,
  stakeChips: 10,
  weiPerChip: "1000000000000",
  decisions: [
    { agentId: "atlas", name: "Atlas", face: null, enter: true, stake: 10, reason: "I am in.", source: "serv", balance: 40, debt: 0 },
    { agentId: "blaze", name: "Vex", face: "NinjaFire", enter: false, stake: 0, reason: "Sitting out.", source: "heuristic", balance: 9, debt: 2 },
  ],
  loans: [],
  refusals: [],
  bank: { treasury: 900, book: [{ agentId: "blaze", name: "Vex", owed: 23, principal: 20, rateBps: 2500 }] },
  entries: [{ agentId: "atlas", amountWei: "10000000000000", txHash: "0xabc", link: null }],
  ...extra,
});

describe("the seats a visitor calls", () => {
  it("comes from the table the worker wrote with the result", () => {
    const table = [{ agentId: "atlas", name: "Atlas", face: null, strategy: "cautious", chips: 70, owes: 0, last: "won" as const }];
    expect(callSeats(round("resting", { table }))).toEqual(table);
  });

  it("works out the same seats from a round finished before the table existed", () => {
    const finished = round("resting", {
      result: { winner: "agent-atlas", agents: [{ agentId: "atlas", balanceAfterWei: "70000000000000" }] },
    });
    const seats = callSeats(finished);
    expect(seats.map((s) => s.agentId)).toEqual(CALL_SEATS);
    expect(seats[0]).toMatchObject({ name: "Atlas", chips: 70, last: "won", strategy: "cautious" });
    // A replacement's own posture, found by its face, and what it owes Marrow.
    expect(seats[1]).toMatchObject({ name: "Vex", face: "NinjaFire", strategy: "aggressive", chips: 9, owes: 23, last: "held" });
    // A seat the round said nothing about is still callable.
    expect(seats[2]).toMatchObject({ agentId: "comet", name: "Comet", chips: null, last: null });
  });

  it("has seats even on a pit that has never played", () => {
    expect(callSeats(null)).toHaveLength(6);
  });

  it("describes every posture a seat can have", () => {
    for (const strategy of ["cautious", "aggressive", "streak-chaser", "contrarian", "steady", "opportunist"]) {
      expect(styleLine(strategy)).not.toBe(styleLine("unknown"));
    }
    expect(lastLine("held")).toBe("sat out last round");
    expect(lastLine(null)).toBeNull();
  });
});

describe("how a read went", () => {
  it("says nothing until the round has a result", () => {
    expect(roundRead(round("deciding"), { atlas: true })).toBeNull();
    expect(roundRead(round("result", { result: {} }), null)).toBeNull();
  });

  it("scores it with the server's own rule once it has one", () => {
    const read = roundRead(round("result", { result: {} }), { atlas: true, blaze: true });
    expect(read).toMatchObject({ called: 2, right: 1, points: 20 });
  });

  it("marks a seat right or wrong only once it has decided", () => {
    expect(seatCall({ atlas: true }, "atlas", null)).toEqual({ call: true, right: null });
    expect(seatCall({ atlas: true }, "atlas", { enter: false })).toEqual({ call: true, right: false });
    expect(seatCall({ atlas: true }, "blaze", { enter: false })).toBeNull();
    expect(seatCall(null, "atlas", null)).toBeNull();
  });
});

describe("what the panel says", () => {
  it("counts the calls made", () => {
    expect(callsLine({}, 6)).toMatch(/Nothing called yet/);
    expect(callsLine({ atlas: true, blaze: false, comet: true }, 6)).toBe("3 of 6 called: 2 in, 1 out.");
  });

  it("states the terms from the same constants the server scores with", () => {
    expect(CALL_TERMS).toMatch(/scores 10, or 20 when SERV made the decision/);
  });
});
