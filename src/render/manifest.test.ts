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
