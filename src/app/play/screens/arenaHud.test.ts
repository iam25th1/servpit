import { describe, expect, it } from "vitest";
import { arenaStanding } from "./arenaHud";

const actor = (id: string, alive: boolean, diedAtTick?: number) => ({ id, alive, diedAtTick });

describe("arenaStanding", () => {
  it("counts everyone before the first death", () => {
    const s = arenaStanding([actor("a", true), actor("b", true), actor("c", true)]);
    expect(s.standing).toBe(3);
    expect(s.downed).toEqual([]);
  });

  it("decrements as the replay eliminates entrants", () => {
    // The defect this replaces: the HUD read placements.length, which is the
    // final placement list and therefore the entrant count, constant for the
    // whole replay. It showed 24 while the feed listed twelve out.
    const s = arenaStanding([actor("a", true), actor("b", false, 4), actor("c", false, 9)]);
    expect(s.standing).toBe(1);
  });

  it("lists the downed most recent first", () => {
    const s = arenaStanding([actor("a", false, 2), actor("b", true), actor("c", false, 9), actor("d", false, 4)]);
    expect(s.downed).toEqual(["c", "d", "a"]);
  });

  it("puts a death with no recorded tick last rather than dropping it", () => {
    const s = arenaStanding([actor("a", false, 3), actor("b", false)]);
    expect(s.standing).toBe(0);
    expect(s.downed).toEqual(["a", "b"]);
  });

  it("accepts the null the timeline reports for a standing actor", () => {
    const s = arenaStanding([
      { id: "a", alive: true, diedAtTick: null },
      { id: "b", alive: false, diedAtTick: 3 },
    ]);
    expect(s.standing).toBe(1);
    expect(s.downed).toEqual(["b"]);
  });

  it("is empty for an arena that has not started", () => {
    expect(arenaStanding([])).toEqual({ standing: 0, downed: [] });
  });

  it("never reports more standing than it was given", () => {
    const actors = Array.from({ length: 24 }, (_, i) => actor(`e${i}`, i > 11, i > 11 ? undefined : i));
    const s = arenaStanding(actors);
    expect(s.standing).toBe(12);
    expect(s.downed).toHaveLength(12);
  });
});
