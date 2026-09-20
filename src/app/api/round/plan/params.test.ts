import { describe, expect, it } from "vitest";
import { parseRoundRequest } from "./params";

describe("parseRoundRequest", () => {
  it("accepts a safe seed and an in range entrant count", () => {
    expect(parseRoundRequest({ seed: "demo", entrants: 24 })).toEqual({ ok: true, seed: "demo", entrants: 24 });
  });

  it("rejects hostile or out of range input", () => {
    for (const bad of [null, "x", {}, { seed: "demo" }, { seed: "<script>", entrants: 24 }, { seed: "demo", entrants: 15 }, { seed: "demo", entrants: 33 }, { seed: "demo", entrants: 24.5 }, { seed: "a".repeat(65), entrants: 24 }]) {
      expect(parseRoundRequest(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});
