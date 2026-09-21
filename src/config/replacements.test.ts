import { describe, expect, it } from "vitest";
import { NAMED_AGENTS } from "./agents";
import { ORIGINAL_FACES, REPLACEMENTS, arrivalFor, faceFor, profileFor } from "./replacements";

describe("the people who take an emptied seat", () => {
  it("gives every one of them a line to say when it sits down", () => {
    for (const r of REPLACEMENTS) {
      expect(r.arrival.trim().length).toBeGreaterThan(0);
      expect(r.arrival).toMatch(/[.?!]$/);
    }
  });

  it("keeps every arrival line short enough to read in the moment", () => {
    for (const r of REPLACEMENTS) expect(r.arrival.length).toBeLessThanOrEqual(90);
  });

  it("writes them in plain language, with no dashes the player has to parse", () => {
    for (const r of REPLACEMENTS) {
      // Built rather than written: this file may not contain the characters
      // it bans, which is the rule it is here to enforce.
      const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
      expect(r.arrival).not.toMatch(dashes);
      expect(r.arrival).not.toMatch(/\bwei\b|basis points|minor units/i);
    }
  });

  it("never gives two of them the same line", () => {
    expect(new Set(REPLACEMENTS.map((r) => r.arrival)).size).toBe(REPLACEMENTS.length);
  });

  it("reads an arrival line off the same identity the face and name come from", () => {
    const seat = NAMED_AGENTS[0].id;
    expect(arrivalFor(seat, `${seat}-1`)).toBeNull();
    const second = arrivalFor(seat, `${seat}-2`);
    expect(second).toBe(REPLACEMENTS[0].arrival);
    expect(arrivalFor(seat, `${seat}-${REPLACEMENTS.length + 2}`)).toBe(second);
  });

  it("still wears a face none of the six who started wear", () => {
    for (const r of REPLACEMENTS) expect(ORIGINAL_FACES).not.toContain(r.face);
  });

  it("puts an original in a seat at generation one and a replacement after", () => {
    const seat = NAMED_AGENTS[0].id;
    expect(profileFor(seat, `${seat}-1`).name).toBe(NAMED_AGENTS[0].name);
    expect(faceFor(seat, `${seat}-1`)).toBeNull();
    expect(REPLACEMENTS.some((r) => r.name === profileFor(seat, `${seat}-2`).name)).toBe(true);
  });
});
