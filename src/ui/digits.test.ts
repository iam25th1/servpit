// Numbers a viewer cannot misread.
//
// Chips, seats, balances, round numbers and agent names are all numbers, and
// the interface draws them with font smoothing off, so every stroke is
// thresholded: it covers a pixel or it does not. On the face this replaced,
// that left two pixels between a 3 and a 9 at body size, which is how 938
// read as 999, 20 as 80, 22 as 88 and bot-20 as bot-80.
//
// So the shipped face is held to a distance. Each digit is rasterised from
// the font file the browser loads, at each size the scale uses, the way a
// thresholding rasteriser does it: a pixel is ink when its centre is inside
// the outline. Then every pair is compared, pixel by pixel.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type Font } from "opentype.js";
import { describe, expect, it } from "vitest";
import { type } from "./tokens";

const file = readFileSync(join(process.cwd(), "public/assets/fonts/Tiny5.ttf"));
const font: Font = parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));

/**
 * The sizes numbers are drawn at: every step of the scale, and the phone's
 * hero, which is the one size the phone does not share with the desktop.
 */
const SIZES = [...new Set([...Object.values(type.size), 40])].sort((a, b) => a - b);

/**
 * How far apart two digits have to be, in pixels, at a given size.
 *
 * One module is the smallest mark this face can make: at a size of S pixels
 * on a grid of eight, a module is S/8 pixels square. Two digits that differ
 * by less than two whole modules differ by a mark smaller than the face's
 * own smallest stroke, which is a difference nobody reads at a glance. Two
 * modules at body size is eight pixels; the face actually manages twelve.
 */
function threshold(size: number): number {
  const side = size / type.grid;
  return 2 * side * side;
}

/** A glyph as pixels, rasterised the way a thresholding rasteriser does it. */
function pixels(character: string, size: number): { on: Uint8Array; width: number; height: number } {
  // A box with room for the glyph and a margin, with the baseline on a whole
  // pixel, which is where the line box puts it.
  const width = Math.ceil(size * 1.5);
  const height = Math.ceil(size * 2);
  const baseline = Math.round(size * 1.4);
  const path = font.getPath(character, 2, baseline, size);

  // Flatten to polygons. This face is drawn in straight lines, but a curve
  // is sampled rather than assumed away.
  const polygons: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  let cursor: [number, number] = [0, 0];
  const curve = (from: [number, number], to: [number, number], control: Array<[number, number]>) => {
    const steps = 8;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const points = [from, ...control, to];
      let level = points;
      while (level.length > 1) {
        const next: Array<[number, number]> = [];
        for (let k = 0; k < level.length - 1; k += 1) {
          next.push([level[k][0] + (level[k + 1][0] - level[k][0]) * t, level[k][1] + (level[k + 1][1] - level[k][1]) * t]);
        }
        level = next;
      }
      current.push(level[0]);
    }
  };
  for (const command of path.commands) {
    if (command.type === "M") {
      if (current.length > 2) polygons.push(current);
      cursor = [command.x, command.y];
      current = [cursor];
    } else if (command.type === "L") {
      cursor = [command.x, command.y];
      current.push(cursor);
    } else if (command.type === "Q") {
      curve(cursor, [command.x, command.y], [[command.x1, command.y1]]);
      cursor = [command.x, command.y];
    } else if (command.type === "C") {
      curve(cursor, [command.x, command.y], [[command.x1, command.y1], [command.x2, command.y2]]);
      cursor = [command.x, command.y];
    } else if (command.type === "Z") {
      if (current.length > 2) polygons.push(current);
      current = [];
    }
  }
  if (current.length > 2) polygons.push(current);

  const on = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // The centre of the pixel, which is what a thresholding rasteriser asks
      // about, with the non zero winding rule the format specifies.
      const px = x + 0.5;
      const py = y + 0.5;
      let winding = 0;
      for (const polygon of polygons) {
        for (let i = 0; i < polygon.length; i += 1) {
          const [x1, y1] = polygon[i];
          const [x2, y2] = polygon[(i + 1) % polygon.length];
          if (y1 <= py && y2 > py) {
            if ((x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) > 0) winding += 1;
          } else if (y2 <= py && y1 > py) {
            if ((x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) < 0) winding -= 1;
          }
        }
      }
      if (winding !== 0) on[y * width + x] = 1;
    }
  }
  return { on, width, height };
}

function differingPixels(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) n += 1;
  return n;
}

describe("the digits, at every size numbers are drawn", () => {
  for (const size of SIZES) {
    it(`keeps every pair of digits apart at ${size}px`, () => {
      const maps = [...Array(10).keys()].map((d) => pixels(String(d), size).on);
      const ink = maps.map((m) => m.reduce((n, v) => n + v, 0));
      expect(Math.min(...ink), `a digit rasterised to nothing at ${size}px`).toBeGreaterThan(0);

      const limit = threshold(size);
      const worst: Array<{ pair: string; diff: number }> = [];
      for (let a = 0; a <= 9; a += 1) {
        for (let b = a + 1; b <= 9; b += 1) {
          worst.push({ pair: `${a} and ${b}`, diff: differingPixels(maps[a], maps[b]) });
        }
      }
      worst.sort((x, y) => x.diff - y.diff);
      expect(
        worst[0].diff,
        `at ${size}px, ${worst[0].pair} differ by ${worst[0].diff} pixels, under the ${limit} this size needs`,
      ).toBeGreaterThanOrEqual(limit);
    });
  }

  it("lines numbers up in a column, because the face gives every digit the same advance", () => {
    const advances = [...Array(10).keys()].map((d) => font.charToGlyph(String(d)).advanceWidth);
    expect(new Set(advances).size, `digit advances differ: ${advances.join(", ")}`).toBe(1);
    // And that advance is a whole number of modules, so a column of numbers
    // lands on whole pixels at every size in the scale.
    const wide = (advances[0] ?? 0) / (font.unitsPerEm / type.grid);
    expect(Number.isInteger(wide), `a digit is ${wide} modules wide`).toBe(true);
  });

  it("draws every digit on the grid, so none of them is left to the threshold", () => {
    const side = font.unitsPerEm / type.grid;
    for (const digit of "0123456789") {
      const path = font.charToGlyph(digit).getPath(0, 0, font.unitsPerEm);
      for (const command of path.commands) {
        if (command.type === "Z") continue;
        for (const value of [command.x, command.y]) {
          if (value === undefined) continue;
          expect(Math.abs(value) % side, `${digit} has a point at ${value}, off the grid`).toBe(0);
        }
      }
    }
  });
});
