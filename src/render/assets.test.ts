import { describe, expect, it } from "vitest";
import { FACING } from "@/engine/events";
import { loadAssets } from "./assets";
import { createFakeLoader, testManifest as manifest } from "./testing";

const fakeLoader = createFakeLoader;

describe("loadAssets", () => {
  it("loads a faceset per actor at the manifest size, for the slot symbols", async () => {
    const store = await loadAssets(manifest, fakeLoader().loader);
    for (const entry of manifest.entries) {
      const faceset = store.actors.get(entry.id)!.faceset;
      expect(faceset.sw, entry.id).toBe(manifest.faceset.width);
      expect(faceset.sh, entry.id).toBe(manifest.faceset.height);
      expect(faceset.sx).toBe(0);
      expect(faceset.sy).toBe(0);
      expect(faceset.image.source).toMatchObject({ path: entry.facesetPath });
    }
  });

  it("fails loudly when a faceset is missing", async () => {
    const { loader } = fakeLoader({ "/assets/Knight/Faceset.png": "missing" });
    await expect(loadAssets(manifest, loader)).rejects.toThrow(/Knight faceset/);
  });

  it("decodes every sheet exactly once", async () => {
    const { loader, loads } = fakeLoader();
    await loadAssets(manifest, loader);
    expect(new Set(loads).size).toBe(loads.length);
    const tilesets = manifest.ui.filter((u) => u.kind === "tileset").length;
    const fonts = manifest.ui.filter((u) => u.kind === "font" && u.path.endsWith(".png")).length;
    const expected = manifest.entries.reduce((n, e) => n + Object.keys(e.sprites).length + 1, 0) + manifest.fx.length + tilesets + fonts;
    expect(loads).toHaveLength(expected);
  });

  it("keeps the bitmap font sheets, which the arena draws nameplates from", async () => {
    const store = await loadAssets(manifest, fakeLoader().loader);
    const small = store.fonts.get("fontBitmapSmall");
    expect(small).toBeDefined();
    // Fifteen columns of eight pixel cells, eight rows.
    expect(small?.width).toBe(120);
    expect(small?.height).toBe(64);
    // The ttf is a DOM face and is deliberately not decoded here.
    expect(store.fonts.has("fontNormal")).toBe(false);
  });

  it("keeps the tileset sheets, which the arena tiles its floor from", async () => {
    const store = await loadAssets(manifest, fakeLoader().loader);
    expect(store.tilesets.get("tilesetFloor")).toBeDefined();
    expect(store.tilesets.get("tilesetFloorDetail")).toBeDefined();
    expect(store.tilesets.size).toBe(manifest.ui.filter((u) => u.kind === "tileset").length);
  });

  it("slices character animations by facing column and frame row", async () => {
    const store = await loadAssets(manifest, fakeLoader().loader);
    const knight = store.actors.get("Knight")!;
    expect(knight.frames.walk[FACING.right]).toHaveLength(4);
    expect(knight.frames.walk[FACING.right][2]).toMatchObject({ sx: 48, sy: 32, sw: 16, sh: 16 });
    expect(knight.frames.idle[FACING.up][0]).toMatchObject({ sx: 16, sy: 0, sw: 16, sh: 16 });
    expect(knight.frames.dead[FACING.left][0]).toMatchObject({ sx: 0, sy: 0, sw: 16, sh: 16 });
  });

  it("falls back to walk frame 0 as the idle pose for NinjaFire and NinjaWater", async () => {
    const store = await loadAssets(manifest, fakeLoader().loader);
    for (const id of ["NinjaFire", "NinjaWater"]) {
      const a = store.actors.get(id)!;
      for (const facing of [0, 1, 2, 3] as const) {
        expect(a.frames.idle[facing]).toEqual([a.frames.walk[facing][0]]);
      }
      expect(a.notes.some((n) => /idle/i.test(n))).toBe(true);
    }
    expect(store.actors.get("Knight")!.frames.idle[0][0].image.source).toMatchObject({ path: "/assets/Knight/Idle.png" });
  });

  it("honours Bear's facingColumns so facing up reads column 2", async () => {
    const store = await loadAssets(manifest, fakeLoader().loader);
    const bear = store.actors.get("Bear")!;
    expect(bear.frames.walk[FACING.up][0].sx).toBe(32);
    expect(bear.frames.walk[FACING.left][0].sx).toBe(16);
    expect(bear.frames.walk[FACING.down][3].sy).toBe(48);
  });

  it("uses the hand sliced frameRects for Dragon", async () => {
    const store = await loadAssets(manifest, fakeLoader().loader);
    const dragon = store.actors.get("Dragon")!;
    expect(dragon.frames.walk[FACING.left][1]).toMatchObject({ sx: 32, sy: 16, sw: 16, sh: 16 });
    expect(dragon.frames.walk[FACING.right][0]).toMatchObject({ sx: 48, sy: 0, sw: 16, sh: 16 });
    expect(dragon.frames.idle[FACING.down]).toEqual([dragon.frames.walk[FACING.down][0]]);
  });

  it("fails loudly when a sheet is missing", async () => {
    const { loader } = fakeLoader({ "/assets/Monk/Walk.png": "missing" });
    await expect(loadAssets(manifest, loader)).rejects.toThrow(/Monk.*walk.*\/assets\/Monk\/Walk\.png/);
  });

  it("fails loudly when a decoded sheet does not match the manifest grid", async () => {
    const { loader } = fakeLoader({ "/assets/Boy/Attack.png": { width: 60, height: 16 } });
    await expect(loadAssets(manifest, loader)).rejects.toThrow(/Boy.*attack.*60x16/);
  });

  it("fails loudly when a frame rect falls outside its sheet", async () => {
    const { loader } = fakeLoader({ "/assets/Dragon/SpriteSheet.png": { width: 48, height: 64 } });
    await expect(loadAssets(manifest, loader)).rejects.toThrow(/Dragon.*sheet/);
  });

  it("slices fx strips and keeps a white variant of every sheet", async () => {
    const store = await loadAssets(manifest, fakeLoader().loader);
    expect(store.fx.get("Cut")!.frames).toHaveLength(4);
    expect(store.fx.get("Explosion")!.frames[8]).toMatchObject({ sx: 320, sy: 0, sw: 40, sh: 40 });
    const knightWalk = store.actors.get("Knight")!.frames.walk[0][0].image;
    expect(store.whiteOf(knightWalk).source).toMatchObject({ white: knightWalk.source });
    expect(store.whiteOf(knightWalk)).toBe(store.whiteOf(knightWalk));
  });
});
