import { describe, expect, it } from "vitest";
import { COMPACT_MAX_HEIGHT, PORTRAIT_MAX_WIDTH, layoutFor, wholePixelWidth } from "./layoutMode";

describe("which layout a viewport gets", () => {
  it("gives a phone held upright the portrait layout", () => {
    for (const [w, h] of [
      [375, 667],
      [390, 844],
      [412, 915],
      [360, 800],
    ]) {
      expect(layoutFor(w, h), `${w}x${h}`).toBe("portrait");
    }
  });

  it("gives a phone on its side the compact layout, because 390 tall is not a stage", () => {
    for (const [w, h] of [
      [844, 390],
      [667, 375],
      [915, 412],
    ]) {
      expect(layoutFor(w, h), `${w}x${h}`).toBe("compact");
    }
  });

  it("gives a tablet upright the portrait layout and a tablet sideways the stage", () => {
    expect(layoutFor(768, 1024)).toBe("portrait");
    expect(layoutFor(810, 1080)).toBe("portrait");
    expect(layoutFor(1024, 768)).toBe("desktop");
  });

  it("gives a desktop the fixed stage", () => {
    expect(layoutFor(1280, 800)).toBe("desktop");
    expect(layoutFor(1440, 900)).toBe("desktop");
    expect(layoutFor(2560, 1440)).toBe("desktop");
  });

  it("falls back to the stage when it is asked about nothing", () => {
    expect(layoutFor(Number.NaN, 800)).toBe("desktop");
    expect(layoutFor(0, 0)).toBe("desktop");
  });

  it("documents its two thresholds rather than hiding them in a query", () => {
    expect(layoutFor(PORTRAIT_MAX_WIDTH, 1000)).toBe("portrait");
    expect(layoutFor(PORTRAIT_MAX_WIDTH + 1, 1000)).toBe("desktop");
    expect(layoutFor(900, COMPACT_MAX_HEIGHT)).toBe("compact");
    expect(layoutFor(900, COMPACT_MAX_HEIGHT + 1)).toBe("desktop");
  });
});

describe("fitting a pixel canvas to a phone", () => {
  it("takes the largest whole number of device pixels per source pixel", () => {
    // 390 css wide at three device pixels each is 1170 device pixels. Two
    // whole copies of a 496 wide canvas fit in that, and a third does not, so
    // every source pixel lands on exactly two device pixels.
    expect(wholePixelWidth(496, 390, 3)).toBeCloseTo((496 * 2) / 3, 5);
    // At two device pixels per css pixel only one copy fits, which is the
    // canvas at half its css width and still pixel exact.
    expect(wholePixelWidth(496, 390, 2)).toBe(248);
    expect(wholePixelWidth(400, 390, 2)).toBe(200);
    expect(wholePixelWidth(400, 390, 3)).toBeCloseTo((400 * 2) / 3, 5);
  });

  it("says so when not even one whole copy fits", () => {
    expect(wholePixelWidth(496, 390, 1)).toBeNull();
    expect(wholePixelWidth(496, 0, 3)).toBeNull();
  });

  it("never returns something wider than the space it was given", () => {
    for (const dpr of [1, 2, 3]) {
      for (const width of [320, 360, 390, 412, 768]) {
        const fitted = wholePixelWidth(496, width, dpr);
        if (fitted !== null) expect(fitted).toBeLessThanOrEqual(width);
      }
    }
  });
});
