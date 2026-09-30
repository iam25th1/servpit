import { describe, expect, it } from "vitest";
import { DEFAULT_ROUND } from "@/config/round";
import { arenaTiles, inArena } from "./arenaShape";
import { resolveRound } from "./resolveRound";

describe("the pit floor", () => {
  it("is every tile of a square pit", () => {
    const arena = { width: 6, height: 4 };
    expect(arenaTiles(arena)).toHaveLength(24);
    expect(inArena(arena, 0, 0)).toBe(true);
    expect(inArena(arena, 6, 0)).toBe(false);
  });

  it("is a disc in a round pit: no corners, and the middle row runs wall to wall", () => {
    const arena = { width: 24, height: 24, shape: "round" as const };
    for (const [x, y] of [[0, 0], [23, 0], [0, 23], [23, 23]]) expect(inArena(arena, x, y)).toBe(false);
    for (let x = 0; x < 24; x++) expect(inArena(arena, x, 11)).toBe(true);
    // About pi r^2 of the 576 tiles.
    const floor = arenaTiles(arena).length;
    expect(floor).toBeGreaterThan(420);
    expect(floor).toBeLessThan(470);
  });

  it("is symmetric, so no side of the colosseum is bigger than another", () => {
    const arena = { width: 24, height: 24, shape: "round" as const };
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        expect(inArena(arena, x, y)).toBe(inArena(arena, 23 - x, y));
        expect(inArena(arena, x, y)).toBe(inArena(arena, y, x));
      }
    }
  });

  it("keeps every fighter on the floor for the whole fight in the default round pit", () => {
    expect(DEFAULT_ROUND.arena.shape).toBe("round");
    for (let i = 0; i < 20; i++) {
      const r = resolveRound(`floor-${i}`, Array.from({ length: 24 }, (_, n) => ({ id: `p${n}` })), DEFAULT_ROUND);
      for (const ev of r.log) if (ev.x !== undefined && ev.y !== undefined) expect(inArena(DEFAULT_ROUND.arena, ev.x, ev.y)).toBe(true);
    }
  });

  it("refuses a shape it does not know", () => {
    const bad = { ...DEFAULT_ROUND, arena: { width: 24, height: 24, shape: "hexagon" } } as unknown as typeof DEFAULT_ROUND;
    expect(() => resolveRound("x", [{ id: "a" }, { id: "b" }], bad)).toThrow(/shape/);
  });
});
