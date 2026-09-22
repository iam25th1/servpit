import { describe, expect, it } from "vitest";
import { SLOT_LAYOUT, paylineY, reelX } from "./layout";
import { symbolAtPoint } from "./probe";
import type { ReelState } from "./reels";

const cell = SLOT_LAYOUT.cell.size;

/** One reel with three symbols in the window, the middle on the payline. */
const reel = (index: number, symbols: [string, string, string]): ReelState => ({
  index,
  offset: 0,
  travelled: 0,
  speed: 0,
  stopped: true,
  symbol: symbols[1],
  window: [
    { symbol: symbols[0], row: -1 },
    { symbol: symbols[1], row: 0 },
    { symbol: symbols[2], row: 1 },
  ],
});

const reels: ReelState[] = [reel(0, ["Bear", "Knight", "Monk"]), reel(1, ["Dragon", "NinjaRed", "Boy"]), reel(2, ["Eskimo", "Cyclope", "Hunter"])];

/** The centre of the cell drawn for this reel and row. */
const centreOf = (index: number, row: number): { x: number; y: number } => ({
  x: reelX(SLOT_LAYOUT, index) + SLOT_LAYOUT.reel.width / 2,
  y: paylineY(SLOT_LAYOUT) + row * cell,
});

describe("the symbol under the pointer", () => {
  it("is the one on the payline in the middle of a reel", () => {
    for (const [index, expected] of [
      [0, "Knight"],
      [1, "NinjaRed"],
      [2, "Cyclope"],
    ] as const) {
      const at = centreOf(index, 0);
      expect(symbolAtPoint(SLOT_LAYOUT, reels, at.x, at.y)).toBe(expected);
    }
  });

  it("is the one above or below when the pointer is there", () => {
    expect(symbolAtPoint(SLOT_LAYOUT, reels, centreOf(0, -1).x, centreOf(0, -1).y)).toBe("Bear");
    expect(symbolAtPoint(SLOT_LAYOUT, reels, centreOf(2, 1).x, centreOf(2, 1).y)).toBe("Hunter");
  });

  it("is nothing in the gap between two reels", () => {
    const between = reelX(SLOT_LAYOUT, 1) - SLOT_LAYOUT.reel.gap / 2;
    expect(symbolAtPoint(SLOT_LAYOUT, reels, between, paylineY(SLOT_LAYOUT))).toBeNull();
  });

  it("is nothing outside the window, including on the lever", () => {
    expect(symbolAtPoint(SLOT_LAYOUT, reels, SLOT_LAYOUT.lever.x, SLOT_LAYOUT.lever.y)).toBeNull();
    expect(symbolAtPoint(SLOT_LAYOUT, reels, 0, 0)).toBeNull();
    expect(symbolAtPoint(SLOT_LAYOUT, reels, SLOT_LAYOUT.width, SLOT_LAYOUT.height)).toBeNull();
  });

  it("is nothing when the reels have nothing in the window", () => {
    const empty = reels.map((r) => ({ ...r, window: [] }));
    expect(symbolAtPoint(SLOT_LAYOUT, empty, centreOf(0, 0).x, centreOf(0, 0).y)).toBeNull();
  });
});
