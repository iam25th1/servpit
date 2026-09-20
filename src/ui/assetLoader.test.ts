import { describe, expect, it } from "vitest";
import manifestJson from "../../public/assets/manifest.json";
import { parseManifest } from "@/render/manifest";
import { preloadList } from "./assetLoader";

const manifest = parseManifest(manifestJson);

describe("preloadList", () => {
  const list = preloadList(manifest);

  it("covers the ui kit, every faceset, every sprite sheet and every fx strip", () => {
    expect(list.length).toBeGreaterThan(80);
    for (const entry of manifest.entries) {
      expect(list, entry.id).toContain(entry.facesetPath);
      for (const sprite of Object.values(entry.sprites)) expect(list).toContain(sprite.path);
    }
    for (const fx of manifest.fx) expect(list).toContain(fx.path);
  });

  it("puts the ui kit first, because the boot screen needs it to draw itself", () => {
    // The ui kit has its own facesetBox and dialogFaceset sprites, so match a
    // roster faceset by its path rather than by the word.
    const firstRosterFaceset = list.findIndex((p) => /^\/assets\/[A-Za-z]+\/Faceset\.png$/.test(p));
    const lastUi = list.map((p) => p.startsWith("/assets/ui/")).lastIndexOf(true);
    expect(firstRosterFaceset).toBeGreaterThan(-1);
    expect(lastUi).toBeLessThan(firstRosterFaceset);
  });

  it("lists no font, since a ttf is not decoded as an image", () => {
    expect(list.some((p) => p.endsWith(".ttf"))).toBe(false);
  });

  it("has no duplicates, so progress reaches exactly one", () => {
    expect(new Set(list).size).toBe(list.length);
  });
});
