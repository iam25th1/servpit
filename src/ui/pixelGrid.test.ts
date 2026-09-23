// Text lands on whole pixels, or it does not get to ship.
//
// The interface turns font smoothing off, so a glyph is thresholded rather
// than blended: a stroke either covers a pixel or it does not. That is kind
// to a pixel face at the size it was drawn for, and brutal at every other
// size. Measured on this page before the face changed, two digits at body
// size differed by two pixels out of about two hundred, which is how 938
// read as 999 and bot-20 as bot-80.
//
// A face drawn on a grid of GRID modules to the em lands on whole pixels
// exactly when the size in pixels is a multiple of GRID, and its advances
// land on whole pixels at those sizes too. So every size in the scale, every
// size written into a stylesheet, every line height and every tracking value
// has to be a whole number of pixels. This holds them there.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type } from "./tokens";

const root = process.cwd();

function stylesheets(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...stylesheets(path));
    else if (entry.endsWith(".css")) out.push(path);
  }
  return out;
}

const sheets = stylesheets(join(root, "src")).map((path) => ({ path: path.slice(root.length + 1), css: readFileSync(path, "utf8") }));

/** A declaration, with enough around it to say where it is. */
interface Declaration {
  file: string;
  line: number;
  value: string;
}

function declarations(property: string): Declaration[] {
  const out: Declaration[] = [];
  for (const sheet of sheets) {
    sheet.css.split("\n").forEach((text, index) => {
      const match = new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;]+);`).exec(text);
      if (match) out.push({ file: sheet.path, line: index + 1, value: match[1].trim() });
    });
  }
  return out;
}

describe("the pixel grid", () => {
  it("names the grid the face is drawn on", () => {
    // Tiny5 is drawn on eight modules to the em. Every coordinate in the
    // face and every advance is a whole number of those modules, so a size
    // that is a multiple of eight puts every one of them on a whole pixel.
    expect(type.grid).toBe(8);
  });

  it("builds the type scale out of whole modules", () => {
    for (const [name, size] of Object.entries(type.size)) {
      expect(size % type.grid, `--text-${name} is ${size}px, which is ${size % type.grid} px off the grid`).toBe(0);
    }
  });

  it("gives every size a whole number line height", () => {
    for (const [leadName, leading] of Object.entries(type.leading)) {
      for (const [sizeName, size] of Object.entries(type.size)) {
        const height = leading * size;
        expect(Number.isInteger(height), `${leadName} leading on ${sizeName} is ${height}px`).toBe(true);
      }
    }
  });

  it("tracks in whole pixels, because a fraction of a pixel is spread unevenly between letters", () => {
    for (const value of Object.values(type.tracking)) {
      expect(value, `tracking ${value} is not a whole number of pixels`).toMatch(/^(0|-?\d+px)$/);
    }
  });
});

describe("the stylesheets", () => {
  it("writes every text size as a token or a whole multiple of the grid", () => {
    for (const declaration of declarations("font-size")) {
      const { value, file, line } = declaration;
      if (value.startsWith("var(")) continue;
      const px = /^(\d+(?:\.\d+)?)px$/.exec(value);
      expect(px, `${file}:${line} sets font-size: ${value}, which is neither a token nor a pixel size`).not.toBeNull();
      const size = Number(px?.[1]);
      expect(size % type.grid, `${file}:${line} sets font-size: ${value}, ${size % type.grid} px off the grid`).toBe(0);
    }
  });

  it("writes every tracking value in whole pixels", () => {
    for (const declaration of declarations("letter-spacing")) {
      const { value, file, line } = declaration;
      if (value.startsWith("var(")) continue;
      expect(value, `${file}:${line} sets letter-spacing: ${value}; em tracking lands between pixels`).toMatch(/^(0|normal|-?\d+px)$/);
    }
  });

  it("writes every line height as a whole number of pixels", () => {
    for (const declaration of declarations("line-height")) {
      const { value, file, line } = declaration;
      if (value.startsWith("var(") || value === "normal" || value === "0") continue;
      const px = /^(\d+)px$/.exec(value);
      const ratio = /^(\d+(?:\.\d+)?)$/.exec(value);
      expect(px !== null || ratio !== null, `${file}:${line} sets line-height: ${value}`).toBe(true);
      if (ratio) {
        for (const [name, size] of Object.entries(type.size)) {
          expect(Number.isInteger(Number(ratio[1]) * size), `${file}:${line} line-height ${value} on ${name} is ${Number(ratio[1]) * size}px`).toBe(true);
        }
      }
    }
  });

  it("keeps the phone scale on the grid too", () => {
    const shell = sheets.find((s) => s.path.endsWith("shell.module.css"));
    expect(shell, "the shell stylesheet is gone").toBeDefined();
    const phone = shell!.css.slice(shell!.css.indexOf('.shell[data-layout="portrait"]'));
    for (const match of phone.matchAll(/--text-([a-z]+):\s*(\d+)px/g)) {
      expect(Number(match[2]) % type.grid, `the phone scale sets --text-${match[1]} to ${match[2]}px`).toBe(0);
    }
  });
});
