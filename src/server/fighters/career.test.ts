import { describe, expect, it } from "vitest";
import { roundFor, roundsFor } from "./career";

const log = (deaths: Array<[string, string | null]>) => deaths.map(([actor, target]) => ({ type: "death", actor, target }));

describe("what a fighter did in a round", () => {
  const round = {
    placements: ["fighter-ash", "agent-atlas", "bot-00", "bot-01", "fighter-bee", "bot-02"],
    log: [
      { type: "spawn", actor: "fighter-ash", target: null },
      ...log([
        ["bot-02", "fighter-ash"],
        ["fighter-bee", "agent-atlas"],
        ["bot-01", "fighter-ash"],
        ["bot-00", null],
      ]),
    ],
  };

  it("reads the placement off the order the round ended in", () => {
    expect(roundFor("ash", "fighter-ash", round)).toMatchObject({ placement: 1, won: true });
    expect(roundFor("bee", "fighter-bee", round)).toMatchObject({ placement: 5, won: false });
  });

  it("counts a kill as a death whose killer was this fighter", () => {
    // Straight off the log the replay is drawn from. No second mechanism.
    expect(roundFor("ash", "fighter-ash", round)?.kills).toBe(2);
    expect(roundFor("bee", "fighter-bee", round)?.kills).toBe(0);
  });

  it("does not count a death nobody caused", () => {
    // The storm kills with no killer, and it is not anybody's kill.
    const storm = { placements: ["fighter-ash", "bot-00"], log: log([["bot-00", null]]) };
    expect(roundFor("ash", "fighter-ash", storm)?.kills).toBe(0);
  });

  it("counts outlasting the field as finishing in the top half", () => {
    // Everybody but the winner dies, so a streak of survivals would be a
    // streak of wins. What is counted is outlasting the field.
    expect(roundFor("ash", "fighter-ash", round)?.outlasted).toBe(true);
    expect(roundFor("bee", "fighter-bee", round)?.outlasted).toBe(false);
    const third = { placements: ["a", "b", "fighter-cy", "d", "e", "f"], log: [] };
    expect(roundFor("cy", "fighter-cy", third)?.outlasted).toBe(true);
  });

  it("says nothing about a fighter that was not in the round", () => {
    expect(roundFor("zed", "fighter-zed", round)).toBeNull();
  });

  it("reads every claimed seat in one pass", () => {
    const rows = roundsFor(
      [
        { handle: "ash", entrantId: "fighter-ash" },
        { handle: "bee", entrantId: "fighter-bee" },
        { handle: "zed", entrantId: "fighter-zed" },
      ],
      round,
    );
    expect(rows.map((r) => r.handle)).toEqual(["ash", "bee"]);
  });
});
