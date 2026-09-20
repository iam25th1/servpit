import { describe, expect, it } from "vitest";
import { ARENA_DEFAULTS, parseArenaParams } from "./params";

describe("parseArenaParams", () => {
  it("defaults to seed demo and 24 entrants", () => {
    expect(parseArenaParams({})).toEqual({ seed: "demo", entrants: 24 });
    expect(ARENA_DEFAULTS).toEqual({ seed: "demo", entrants: 24 });
  });

  it("accepts a safe seed and an entrant count inside the mode bounds", () => {
    expect(parseArenaParams({ seed: "night-7", entrants: "32" })).toEqual({ seed: "night-7", entrants: 32 });
    expect(parseArenaParams({ seed: "x", entrants: "16" })).toEqual({ seed: "x", entrants: 16 });
  });

  it("falls back on anything hostile or out of range instead of throwing", () => {
    expect(parseArenaParams({ seed: "<script>", entrants: "24" }).seed).toBe("demo");
    expect(parseArenaParams({ seed: "a".repeat(65) }).seed).toBe("demo");
    expect(parseArenaParams({ seed: ["a", "b"] }).seed).toBe("demo");
    expect(parseArenaParams({ entrants: "15" }).entrants).toBe(24);
    expect(parseArenaParams({ entrants: "33" }).entrants).toBe(24);
    expect(parseArenaParams({ entrants: "24.5" }).entrants).toBe(24);
    expect(parseArenaParams({ entrants: "1e1" }).entrants).toBe(24);
    expect(parseArenaParams({ entrants: ["24"] }).entrants).toBe(24);
  });
});
