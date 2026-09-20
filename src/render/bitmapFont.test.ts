import { describe, expect, it } from "vitest";
import { GLYPH, glyphCell, textWidth, FONT_COLUMNS, FONT_FIRST_CHAR, plateLeft, clampRun } from "./bitmapFont";

describe("glyphCell", () => {
  it("maps a character to its cell on the sheet", () => {
    // The sheet starts at space and runs fifteen glyphs to a row.
    expect(glyphCell(" ")).toEqual({ col: 0, row: 0 });
    expect(glyphCell("!")).toEqual({ col: 1, row: 0 });
    expect(glyphCell("A")).toEqual({ col: 3, row: 2 });
    expect(glyphCell("D")).toEqual({ col: 6, row: 2 });
    expect(glyphCell("Z")).toEqual({ col: 13, row: 3 });
    expect(glyphCell("a")).toEqual({ col: 5, row: 4 });
    expect(glyphCell("0")).toEqual({ col: 1, row: 1 });
  });

  it("agrees with the arithmetic it documents", () => {
    for (const ch of "Delta Atlas bot-12 0489") {
      const i = ch.charCodeAt(0) - FONT_FIRST_CHAR;
      expect(glyphCell(ch)).toEqual({ col: i % FONT_COLUMNS, row: Math.floor(i / FONT_COLUMNS) });
    }
  });

  it("has no cell for a character the sheet does not carry", () => {
    expect(glyphCell("\n")).toBeNull();
    expect(glyphCell("é")).toBeNull();
    expect(glyphCell("")).toBeNull();
  });
});

describe("textWidth", () => {
  it("is one glyph box per character", () => {
    expect(textWidth("Delta")).toBe(5 * GLYPH);
    expect(textWidth("")).toBe(0);
    expect(textWidth("A")).toBe(GLYPH);
  });

  it("counts a character the sheet cannot draw, so the run stays aligned", () => {
    // A missing glyph leaves a hole rather than closing up, because closing
    // up would shift every later glyph off the whole pixel grid.
    expect(textWidth("A\nB")).toBe(3 * GLYPH);
  });
});

describe("plateLeft", () => {
  it("centres the run over the sprite on a whole pixel", () => {
    // Sprite is 16 wide at x = 100. "AB" is 16 wide, so it starts at 100.
    expect(plateLeft(100, 16, "AB")).toBe(100);
    // "A" is 8 wide, so it starts four in.
    expect(plateLeft(100, 16, "A")).toBe(104);
  });

  it("never lands on a half pixel, whatever the odd width", () => {
    for (const text of ["A", "AB", "ABC", "Delta", "Ember", "bot-1"]) {
      for (const x of [0, 7, 100, 101]) {
        expect(Number.isInteger(plateLeft(x, 16, text)), `${text} at ${x}`).toBe(true);
      }
    }
  });

  it("lets a long name overhang rather than squeezing it", () => {
    // Nothing is scaled or clipped here; a wide name simply starts left of
    // the sprite. The caller decides whether that matters.
    expect(plateLeft(100, 16, "Bartholomew")).toBeLessThan(100);
  });
});

describe("clampRun", () => {
  it("leaves a run that already fits where it is", () => {
    expect(clampRun(100, 40, 8, 200)).toBe(100);
  });

  it("pulls a run back inside the right edge", () => {
    // A fighter near the wall had its name running off the canvas: the
    // arena clips, so half of "Blaze" simply was not there.
    expect(clampRun(180, 40, 8, 200)).toBe(160);
  });

  it("pushes a run inside the left edge", () => {
    expect(clampRun(-5, 40, 8, 200)).toBe(8);
  });

  it("prefers the near edge when the run is wider than the space", () => {
    // Nothing is scaled or truncated, so an over wide run has to start
    // somewhere. The start is the readable end.
    expect(clampRun(50, 300, 8, 200)).toBe(8);
  });

  it("stays on whole pixels", () => {
    for (const x of [-9, 0, 3, 177, 1000]) expect(Number.isInteger(clampRun(x, 40, 8, 200))).toBe(true);
  });
});
