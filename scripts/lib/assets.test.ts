import { describe, expect, it } from "vitest";
import {
  frameGrid,
  isMacosxPath,
  pickMonsterSheet,
  readPngSize,
  dimensionWarnings,
} from "./assets";

function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

describe("readPngSize", () => {
  it("reads width and height from the IHDR chunk", () => {
    expect(readPngSize(pngHeader(38, 38))).toEqual({ width: 38, height: 38 });
    expect(readPngSize(pngHeader(64, 16))).toEqual({ width: 64, height: 16 });
  });

  it("rejects a buffer without the PNG signature", () => {
    const bad = pngHeader(16, 16);
    bad[0] = 0;
    expect(() => readPngSize(bad)).toThrow(/PNG/);
  });

  it("rejects a truncated buffer", () => {
    expect(() => readPngSize(Buffer.alloc(10))).toThrow(/PNG/);
  });
});

describe("frameGrid", () => {
  it("divides a sheet into whole frames", () => {
    expect(frameGrid(64, 16, 16)).toEqual({ cols: 4, rows: 1 });
    expect(frameGrid(64, 64, 16)).toEqual({ cols: 4, rows: 4 });
  });

  it("throws when the sheet is not a whole number of frames", () => {
    expect(() => frameGrid(70, 16, 16)).toThrow(/multiple/);
  });
});

describe("pickMonsterSheet", () => {
  it("returns the single non Faceset png regardless of its name or case", () => {
    expect(pickMonsterSheet(["Faceset.png", "SpriteSheet.png"])).toBe("SpriteSheet.png");
    expect(pickMonsterSheet(["Faceset.png", "Bear.png"])).toBe("Bear.png");
    expect(pickMonsterSheet(["faceset.png", "cyclope.png"])).toBe("cyclope.png");
  });

  it("ignores non png files and macOS metadata", () => {
    expect(pickMonsterSheet(["Faceset.png", "._Dragon.png", "notes.txt", "Dragon.png"])).toBe("Dragon.png");
  });

  it("throws when there is no candidate or more than one", () => {
    expect(() => pickMonsterSheet(["Faceset.png"])).toThrow(/exactly one/);
    expect(() => pickMonsterSheet(["Faceset.png", "A.png", "B.png"])).toThrow(/exactly one/);
  });

  it("rejects names that are not plain file names", () => {
    expect(() => pickMonsterSheet(["Faceset.png", "../evil.png"])).toThrow(/exactly one/);
  });
});

describe("isMacosxPath", () => {
  it("flags __MACOSX folders and AppleDouble files", () => {
    expect(isMacosxPath("__MACOSX/Ninja/Actor/x.png")).toBe(true);
    expect(isMacosxPath("Ninja/__MACOSX/x.png")).toBe(true);
    expect(isMacosxPath("Ninja/Actor/._Faceset.png")).toBe(true);
    expect(isMacosxPath("Ninja/Actor/Faceset.png")).toBe(false);
  });
});

describe("dimensionWarnings", () => {
  it("is empty when everything matches the expected sizes", () => {
    expect(
      dimensionWarnings({
        id: "Knight",
        tier: "common",
        faceset: { width: 38, height: 38 },
        sheets: { idle: { width: 64, height: 16 } },
      }),
    ).toEqual([]);
    expect(
      dimensionWarnings({
        id: "Bear",
        tier: "rare",
        faceset: { width: 38, height: 38 },
        sheets: { sheet: { width: 64, height: 64 } },
      }),
    ).toEqual([]);
  });

  it("names the entry, file and actual size when something is off", () => {
    const w = dimensionWarnings({
      id: "Dragon",
      tier: "rare",
      faceset: { width: 40, height: 38 },
      sheets: { sheet: { width: 96, height: 64 } },
    });
    expect(w).toHaveLength(2);
    expect(w[0]).toMatch(/Dragon.*Faceset.*40x38/);
    expect(w[1]).toMatch(/Dragon.*sheet.*96x64/);
  });
});

import { SHEET_NOTES, facingColumnsFor } from "./assets";

describe("facingColumnsFor", () => {
  it("maps facing 0 to 3 onto sheet columns in pack order for characters and Cyclope", () => {
    expect(facingColumnsFor("Knight")).toEqual([0, 1, 2, 3]);
    expect(facingColumnsFor("NinjaFire")).toEqual([0, 1, 2, 3]);
    expect(facingColumnsFor("Cyclope")).toEqual([0, 1, 2, 3]);
  });

  it("Bear stores left before up", () => {
    expect(facingColumnsFor("Bear")).toEqual([0, 2, 1, 3]);
  });

  it("Dragon has no uniform columns and carries a note", () => {
    expect(facingColumnsFor("Dragon")).toBeNull();
    expect(SHEET_NOTES.Dragon).toMatch(/32/);
  });
});

import { DRAGON_FRAME_RECTS, FX_SHEETS, fxFrameGrid } from "./assets";

describe("fxFrameGrid", () => {
  it("treats a strip as square frames of the sheet height", () => {
    expect(fxFrameGrid(128, 32)).toEqual({ frameWidth: 32, frameHeight: 32, cols: 4, rows: 1 });
    expect(fxFrameGrid(160, 32)).toEqual({ frameWidth: 32, frameHeight: 32, cols: 5, rows: 1 });
    expect(fxFrameGrid(360, 40)).toEqual({ frameWidth: 40, frameHeight: 40, cols: 9, rows: 1 });
  });

  it("throws when the width is not a whole number of square frames", () => {
    expect(() => fxFrameGrid(240, 14)).toThrow(/multiple/);
  });
});

describe("FX_SHEETS", () => {
  it("lists the eight attack effects, smoke and explosion, never slash", () => {
    const ids = FX_SHEETS.map((f) => f.id);
    expect(ids).toEqual([
      "Cut", "CutDouble", "CutX", "Claw", "ClawDouble", "SlashCurved", "SlashDoubleCurved", "CircularSlash",
      "Smoke", "Explosion",
    ]);
    expect(FX_SHEETS.filter((f) => f.group === "attack")).toHaveLength(8);
    for (const f of FX_SHEETS) expect(f.source).not.toMatch(/FX\/Slash\//);
  });
});

describe("DRAGON_FRAME_RECTS", () => {
  it("hand slices four 16x16 frames per facing inside the 64x64 sheet", () => {
    for (const facing of ["down", "up", "left", "right"] as const) {
      const rects = DRAGON_FRAME_RECTS[facing];
      expect(rects).toHaveLength(4);
      rects.forEach((r, i) => {
        expect(r).toEqual({ x: r.x, y: i * 16, w: 16, h: 16 });
        expect(r.x + r.w).toBeLessThanOrEqual(64);
      });
    }
    expect(DRAGON_FRAME_RECTS.down[0].x).toBe(0);
    expect(DRAGON_FRAME_RECTS.up[0].x).toBe(16);
    expect(DRAGON_FRAME_RECTS.left[0].x).toBe(32);
    expect(DRAGON_FRAME_RECTS.right[0].x).toBe(48);
  });
});
