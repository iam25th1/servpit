import { describe, expect, it } from "vitest";
import { ballTone, knobRows, rodColumns } from "./leverSprite";

describe("ballTone", () => {
  const R = 10;

  it("is nothing outside the ball", () => {
    expect(ballTone(R, R, R)).toBeNull();
    expect(ballTone(-R, -R, R)).toBeNull();
    expect(ballTone(0, R + 1, R)).toBeNull();
  });

  it("gives every pixel inside the ball a tone", () => {
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        expect(ballTone(dx, dy, R), `${dx},${dy}`).not.toBeNull();
      }
    }
  });

  it("lights the upper left and shades the lower right, so the ball reads as round", () => {
    expect(ballTone(-4, -4, R)).toBe("highlight");
    expect(ballTone(4, 4, R)).toBe("shadow");
    expect(ballTone(0, 0, R)).toBe("body");
  });

  it("rims the outer edge, which is what makes it pixel art rather than a disc", () => {
    expect(ballTone(0, -R, R)).toBe("rim");
    expect(ballTone(R, 0, R)).toBe("rim");
    expect(ballTone(0, R, R)).toBe("rim");
  });

  it("refuses a radius that cannot be drawn", () => {
    expect(() => ballTone(0, 0, 0)).toThrow(RangeError);
    expect(() => ballTone(0, 0, -3)).toThrow(RangeError);
  });
});

describe("knobRows", () => {
  it("returns one run per tone per row, left to right, covering the ball", () => {
    const rows = knobRows(10);
    expect(rows.length).toBeGreaterThan(0);
    for (const run of rows) {
      expect(run.width).toBeGreaterThan(0);
      expect(["rim", "highlight", "body", "shadow"]).toContain(run.tone);
    }
    // The widest row is the ball's middle and spans the full diameter.
    const widest = Math.max(...[...new Set(rows.map((r) => r.dy))].map((dy) => rows.filter((r) => r.dy === dy).reduce((n, r) => n + r.width, 0)));
    expect(widest).toBe(21);
  });

  it("is whole pixels only, so nothing lands on a half pixel", () => {
    for (const run of knobRows(9)) {
      expect(Number.isInteger(run.dx)).toBe(true);
      expect(Number.isInteger(run.dy)).toBe(true);
      expect(Number.isInteger(run.width)).toBe(true);
    }
  });
});

describe("rodColumns", () => {
  it("is a shaded rod, not a hairline", () => {
    const cols = rodColumns(4);
    expect(cols.map((c) => c.tone)).toEqual(["highlight", "body", "body", "shadow"]);
    expect(cols.map((c) => c.dx)).toEqual([-2, -1, 0, 1]);
  });

  it("keeps a light and a dark edge however wide it is", () => {
    const cols = rodColumns(6);
    expect(cols).toHaveLength(6);
    expect(cols[0].tone).toBe("highlight");
    expect(cols.at(-1)?.tone).toBe("shadow");
  });

  it("refuses a rod too narrow to shade", () => {
    expect(() => rodColumns(2)).toThrow(RangeError);
  });
});
