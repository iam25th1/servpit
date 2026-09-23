import { describe, expect, it } from "vitest";
import manifestJson from "../../public/assets/manifest.json";
import { parseManifest } from "./manifest";

const clone = () => structuredClone(manifestJson) as Record<string, unknown>;

describe("parseManifest", () => {
  it("accepts the committed manifest", () => {
    const m = parseManifest(manifestJson);
    expect(m.entries).toHaveLength(16);
    expect(m.fx.length).toBeGreaterThanOrEqual(10);
    expect(m.facingOrder).toEqual(["down", "up", "left", "right"]);
  });

  it("exposes Dragon frame rects and Bear facing columns as parsed", () => {
    const m = parseManifest(manifestJson);
    const dragon = m.entries.find((e) => e.id === "Dragon")!;
    expect(dragon.sprites.sheet.facingColumns).toBeNull();
    expect(dragon.sprites.sheet.frameRects?.left).toHaveLength(4);
    const bear = m.entries.find((e) => e.id === "Bear")!;
    expect(bear.sprites.sheet.facingColumns).toEqual([0, 2, 1, 3]);
  });

  it("parses the audio section and constrains paths to same origin audio files", () => {
    const m = parseManifest(manifestJson);
    expect(m.audio.length).toBeGreaterThanOrEqual(10);
    expect(m.audio.find((a) => a.id === "reelSpin")?.loop).toBe(true);
    expect(m.audio.find((a) => a.id === "reelStop")?.loop).toBe(false);
    // Wav for the cues, ogg for the two music beds, and nothing off origin.
    for (const a of m.audio) expect(a.path).toMatch(/^\/assets\/audio\/[A-Za-z0-9_-]+\.(wav|ogg)$/);
  });

  it("rejects an audio entry with a foreign path or a non boolean loop", () => {
    const j = clone();
    (j.audio as Array<Record<string, unknown>>)[0].path = "https://example.com/evil.wav";
    expect(() => parseManifest(j)).toThrow(/audio\[0\].path/);
    const k = clone();
    (k.audio as Array<Record<string, unknown>>)[0].loop = "yes";
    expect(() => parseManifest(k)).toThrow(/audio\[0\].loop/);
  });

  it("rejects a sprite with neither facingColumns nor frameRects", () => {
    const j = clone();
    const entries = j.entries as Array<{ id: string; sprites: Record<string, Record<string, unknown>> }>;
    const dragon = entries.find((e) => e.id === "Dragon")!;
    delete dragon.sprites.sheet.frameRects;
    expect(() => parseManifest(j)).toThrow(/Dragon.*sheet.*frameRects/);
  });

  it("rejects facingColumns that are not four column indexes", () => {
    const j = clone();
    const entries = j.entries as Array<{ id: string; sprites: Record<string, Record<string, unknown>> }>;
    entries.find((e) => e.id === "Bear")!.sprites.sheet.facingColumns = [0, 2, 9, 3];
    expect(() => parseManifest(j)).toThrow(/Bear.*facingColumns/);
  });

  it("rejects a missing path, a non integer grid, or an unknown top level shape", () => {
    const j = clone();
    const entries = j.entries as Array<{ id: string; sprites: Record<string, Record<string, unknown>> }>;
    entries.find((e) => e.id === "Knight")!.sprites.walk.path = 42;
    expect(() => parseManifest(j)).toThrow(/Knight.*walk.*path/);
    const k = clone();
    (k.fx as Array<Record<string, unknown>>)[0].cols = 2.5;
    expect(() => parseManifest(k)).toThrow(/fx.*cols/);
    expect(() => parseManifest(null)).toThrow(/manifest/);
    expect(() => parseManifest({ entries: [] })).toThrow(/manifest/);
  });
});

describe("ui section", () => {
  it("parses every ui entry, with a slice on each nine patch and a tile on each tileset", () => {
    const m = parseManifest(manifestJson);
    expect(m.ui.length).toBeGreaterThanOrEqual(40);
    const ninePatches = m.ui.filter((u) => u.kind === "ninePatch");
    expect(ninePatches.length).toBeGreaterThanOrEqual(10);
    for (const p of ninePatches) {
      expect(p.slice, p.id).toBeDefined();
      expect(p.slice!.x * 2).toBeLessThanOrEqual(p.width);
      expect(p.slice!.y * 2).toBeLessThanOrEqual(p.height);
    }
    for (const t of m.ui.filter((u) => u.kind === "tileset")) expect(t.tile, t.id).toBeGreaterThan(0);
    for (const f of m.ui.filter((u) => u.kind === "font")) expect(f.path).toMatch(/\.(ttf|png)$/);
  });

  it("resolves every emote and mode icon to a ui entry that exists", () => {
    const m = parseManifest(manifestJson);
    const ids = new Set(m.ui.map((u) => u.id));
    for (const id of Object.values(m.emotes)) expect(ids.has(id), id).toBe(true);
    for (const id of Object.values(m.modeIcons)) expect(ids.has(id), id).toBe(true);
    expect(Object.keys(m.modeIcons)).toContain("battleRoyale");
  });

  it("rejects a nine patch whose slice would overlap its own corners", () => {
    const j = clone();
    const entry = (j.ui as Array<Record<string, unknown>>).find((u) => u.kind === "ninePatch")!;
    entry.slice = { x: 99, y: 99 };
    expect(() => parseManifest(j)).toThrow(/does not fit inside/);
  });

  it("rejects a nine patch with no slice, and a ui path outside the assets directory", () => {
    const j = clone();
    const entry = (j.ui as Array<Record<string, unknown>>).find((u) => u.kind === "ninePatch")!;
    delete entry.slice;
    expect(() => parseManifest(j)).toThrow(/needs a slice/);
    const k = clone();
    (k.ui as Array<Record<string, unknown>>)[0].path = "https://example.com/evil.png";
    expect(() => parseManifest(k)).toThrow(/ui\[0\].path/);
  });

  it("rejects an emote pointing at a ui id that does not exist", () => {
    const j = clone();
    (j.emotes as Record<string, string>).committed = "not-a-real-id";
    expect(() => parseManifest(j)).toThrow(/unknown ui id/);
  });
});
