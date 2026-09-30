import { describe, expect, it } from "vitest";
import { PERFECT_READ_BONUS, READ_POINTS, REASONED_READ_POINTS, normaliseCalls, readLine, readOutcome, scoreRead } from "./reads";

const SEATS = ["atlas", "blaze", "comet", "delta", "ember", "flint"];

describe("normaliseCalls", () => {
  it("keeps true and false calls on seats the pit has", () => {
    expect(normaliseCalls({ atlas: true, blaze: false }, SEATS)).toEqual({ atlas: true, blaze: false });
  });

  it("refuses anything that is not a call on a known seat", () => {
    expect(normaliseCalls(null, SEATS)).toBeNull();
    expect(normaliseCalls([], SEATS)).toBeNull();
    expect(normaliseCalls({}, SEATS)).toBeNull();
    expect(normaliseCalls({ bot: true }, SEATS)).toBeNull();
    expect(normaliseCalls({ atlas: "yes" }, SEATS)).toBeNull();
    expect(normaliseCalls({ atlas: 1 }, SEATS)).toBeNull();
    expect(normaliseCalls("atlas", SEATS)).toBeNull();
  });
});

describe("scoreRead", () => {
  const decisions = [
    { agentId: "atlas", enter: false, source: "serv" },
    { agentId: "blaze", enter: true, source: "serv" },
    { agentId: "comet", enter: true, source: "heuristic" },
    { agentId: "delta", enter: false, source: "learned" },
    { agentId: "ember", enter: true, source: "heuristic" },
    { agentId: "flint", enter: false, source: "heuristic" },
  ];
  const outcome = readOutcome(decisions, SEATS);

  it("pays double for a right call on a decision SERV made", () => {
    const result = scoreRead({ blaze: true, comet: true }, outcome);
    expect(result.seats.blaze).toEqual({ call: true, right: true, points: REASONED_READ_POINTS });
    expect(result.seats.comet).toEqual({ call: true, right: true, points: READ_POINTS });
    expect(result.points).toBe(REASONED_READ_POINTS + READ_POINTS);
    expect(result.perfect).toBe(false);
  });

  it("pays nothing for a wrong call", () => {
    const result = scoreRead({ atlas: true }, outcome);
    expect(result).toMatchObject({ called: 1, right: 0, points: 0 });
    expect(result.seats.atlas.right).toBe(false);
  });

  it("adds the bonus only when every seat is called and every call is right", () => {
    const all = { atlas: false, blaze: true, comet: true, delta: false, ember: true, flint: false };
    const result = scoreRead(all, outcome);
    expect(result.perfect).toBe(true);
    expect(result.points).toBe(2 * REASONED_READ_POINTS + 4 * READ_POINTS + PERFECT_READ_BONUS);
    const five = { atlas: false, blaze: true, comet: true, delta: false, ember: true };
    expect(scoreRead(five, outcome).perfect).toBe(false);
  });

  it("counts an agent turned away for its balance as out, because it did not buy in", () => {
    const turnedAway = readOutcome([{ agentId: "atlas", enter: false, source: "serv" }], SEATS);
    expect(scoreRead({ atlas: false }, turnedAway).seats.atlas.right).toBe(true);
    // A seat with no decision at all did not buy in either.
    expect(scoreRead({ blaze: false }, turnedAway).seats.blaze.right).toBe(true);
  });

  it("ignores calls on seats outside the round", () => {
    expect(scoreRead({ nobody: true } as never, outcome)).toMatchObject({ called: 0, points: 0, perfect: false });
  });
});

describe("readLine", () => {
  it("says how the read went in one sentence", () => {
    expect(readLine({ called: 6, right: 6, perfect: true, points: 170, seats: {} })).toBe("You read all 6 right. 170 points, bonus included.");
    expect(readLine({ called: 4, right: 3, perfect: false, points: 40, seats: {} })).toBe("You read 3 of 4 right, for 40 points.");
    expect(readLine({ called: 2, right: 0, perfect: false, points: 0, seats: {} })).toBe("You read none of your 2 calls right this time.");
    expect(readLine({ called: 0, right: 0, perfect: false, points: 0, seats: {} })).toBe("");
  });
});
