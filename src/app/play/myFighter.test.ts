import { describe, expect, it } from "vitest";
import type { ArenaFeedRound } from "./arenaScreens";
import { careerLine, myRound, myRoundLine, ordinal, plateNames, type CareerRow, type ClaimedSeat } from "./myFighter";

const mine: ClaimedSeat = { handle: "ash", name: "Cinder", face: "Monk", entrantId: "fighter-ash" };
const other: ClaimedSeat = { handle: "bee", name: "Bee", face: "Bear", entrantId: "fighter-bee" };

const round = (over: Partial<ArenaFeedRound> = {}): ArenaFeedRound =>
  ({
    roundId: "r-1",
    startedAt: "",
    phase: "result",
    phases: [],
    network: "fake",
    backend: "fake",
    entrants: 24,
    bots: 18,
    stakeChips: 10,
    weiPerChip: "1",
    decisions: [],
    loans: [],
    refusals: [],
    bank: null,
    entries: [],
    fighters: [mine, other],
    fight: {
      seed: "s",
      durationMs: 1,
      characters: [],
      log: [
        { type: "death", actor: "bot-00", target: "fighter-ash" },
        { type: "death", actor: "fighter-bee", target: "agent-atlas" },
        { type: "death", actor: "bot-01", target: null },
      ],
      placements: ["agent-atlas", "fighter-ash", "bot-00", "fighter-bee"],
      names: { "agent-atlas": "Atlas" },
    },
    ...over,
  }) as ArenaFeedRound;

describe("whose name the arena draws", () => {
  it("draws the agents and this viewer's own fighter", () => {
    expect(plateNames(round(), mine)).toEqual({ "agent-atlas": "Atlas", "fighter-ash": "Cinder" });
  });

  it("never draws somebody else's fighter", () => {
    // Twenty four plates is noise. One is the thing a viewer came to watch.
    const names = plateNames(round(), mine);
    expect(names["fighter-bee"]).toBeUndefined();
  });

  it("draws nothing extra for a viewer with no fighter", () => {
    expect(plateNames(round(), null)).toEqual({ "agent-atlas": "Atlas" });
  });

  it("draws nothing for a fighter that is not in this round", () => {
    const absent = { ...mine, entrantId: "fighter-zed" };
    expect(plateNames(round(), absent)["fighter-zed"]).toBeUndefined();
  });
});

describe("how the viewer's fighter did", () => {
  it("reads the placement and the kills off the round", () => {
    expect(myRound(round(), mine)).toEqual({ placement: 2, field: 4, kills: 1, won: false });
    // Bee died at Atlas's hand rather than killing anybody: a kill is a
    // death whose target is the killer, which is what the log records.
    expect(myRound(round(), other)).toEqual({ placement: 4, field: 4, kills: 0, won: false });
  });

  it("says nothing before the fight has been shown", () => {
    expect(myRound(round({ fight: undefined }), mine)).toBeNull();
    expect(myRound(round(), null)).toBeNull();
  });

  it("puts it in a sentence, with the streak when there is one", () => {
    expect(myRoundLine("Cinder", { placement: 2, field: 24, kills: 3, won: false }, 4)).toBe(
      "Cinder finished 2nd of 24, with 3 kills. 4 rounds in the top half in a row.",
    );
    expect(myRoundLine("Cinder", { placement: 1, field: 24, kills: 0, won: true }, 1)).toBe("Cinder won it, with no kills.");
    expect(myRoundLine("Cinder", null, 3)).toBeNull();
  });

  it("says an ordinal the way a person would", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });
});

describe("the record in a sentence", () => {
  const row: CareerRow = { handle: "ash", name: "Cinder", face: "Monk", rounds: 9, wins: 1, best: 1, kills: 7, streak: 2, longest: 4 };

  it("says the whole record in one line", () => {
    expect(careerLine(row)).toBe("Cinder: 9 rounds, 1 win, best 1st, 7 kills, streak 2 and a longest of 4.");
  });

  it("says nothing before there is a record", () => {
    expect(careerLine(null)).toBeNull();
    expect(careerLine({ ...row, rounds: 0 })).toBeNull();
  });
});
