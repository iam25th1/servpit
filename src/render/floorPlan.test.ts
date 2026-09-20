import { describe, expect, it } from "vitest";
import { DETAIL_IN, floorPlan } from "./floorPlan";

describe("floorPlan", () => {
  it("covers every cell of the arena", () => {
    const plan = floorPlan(12, 9, "seed", 4, 6);
    expect(plan).toHaveLength(9);
    for (const row of plan) expect(row).toHaveLength(12);
  });

  it("is the same every call, so the floor cannot flicker between frames", () => {
    // The floor is redrawn on every frame of the replay. If the variation
    // were random per call the whole floor would crawl, which is exactly the
    // kind of motion this project does not allow.
    const a = floorPlan(20, 20, "round-7", 4, 6);
    const b = floorPlan(20, 20, "round-7", 4, 6);
    expect(b).toEqual(a);
  });

  it("gives a different floor to a different round", () => {
    const a = floorPlan(20, 20, "round-7", 4, 6);
    const b = floorPlan(20, 20, "round-8", 4, 6);
    expect(b).not.toEqual(a);
  });

  it("only ever names a base tile it was given", () => {
    for (const row of floorPlan(30, 30, "s", 3, 5)) {
      for (const cell of row) {
        expect(cell.base).toBeGreaterThanOrEqual(0);
        expect(cell.base).toBeLessThan(3);
      }
    }
  });

  it("only ever names a detail it was given, or none", () => {
    for (const row of floorPlan(30, 30, "s", 3, 5)) {
      for (const cell of row) {
        if (cell.detail === null) continue;
        expect(cell.detail).toBeGreaterThanOrEqual(0);
        expect(cell.detail).toBeLessThan(5);
      }
    }
  });

  it("scatters details thinly, so the floor reads as a floor and not as a pattern", () => {
    const plan = floorPlan(40, 40, "s", 4, 6);
    const details = plan.flat().filter((c) => c.detail !== null).length;
    const share = details / 1600;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(2 / DETAIL_IN);
  });

  it("draws nothing at all when there are no detail sprites", () => {
    const plan = floorPlan(10, 10, "s", 2, 0);
    expect(plan.flat().every((c) => c.detail === null)).toBe(true);
  });

  it("refuses an arena with no base tiles rather than drawing an empty floor", () => {
    expect(() => floorPlan(10, 10, "s", 0, 4)).toThrow(RangeError);
  });

  it("is empty for an arena with no cells", () => {
    expect(floorPlan(0, 0, "s", 2, 2)).toEqual([]);
  });
});
