import { describe, expect, it } from "vitest";
import { NAMED_AGENTS } from "./agents";
import { ORIGINAL_FACES, REPLACEMENTS, arrivalFor, chooseOccupant, faceFor, profileFor, replacementById } from "./replacements";

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

  // Two seats holding one person is what this is here to stop. Walking the
  // pool by generation alone did exactly that: every seat on its second
  // occupant was Onyx, so the lineup showed one name and one face twice.
  it("never puts somebody already seated into another seat", () => {
    const first = chooseOccupant(NAMED_AGENTS[0].id, []);
    const second = chooseOccupant(NAMED_AGENTS[1].id, [first.id]);
    const third = chooseOccupant(NAMED_AGENTS[2].id, [first.id, second.id]);
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    expect(new Set([first.face, second.face, third.face]).size).toBe(3);
  });

  it("fills every seat at once without repeating anyone", () => {
    const taken: string[] = [];
    for (const seat of NAMED_AGENTS) taken.push(chooseOccupant(seat.id, taken).id);
    expect(new Set(taken).size).toBe(NAMED_AGENTS.length);
  });

  it("is deterministic, so the same seat and the same room give the same answer", () => {
    const seat = NAMED_AGENTS[3].id;
    expect(chooseOccupant(seat, ["onyx"]).id).toBe(chooseOccupant(seat, ["onyx"]).id);
  });

  it("still gives somebody when the pool is somehow all seated", () => {
    const everyone = REPLACEMENTS.map((r) => r.id);
    expect(replacementById(chooseOccupant(NAMED_AGENTS[0].id, everyone).id)).toBeDefined();
  });

  it("reads a recorded occupant rather than the generation", () => {
    const seat = NAMED_AGENTS[0].id;
    const chosen = REPLACEMENTS[4];
    expect(profileFor(seat, `${seat}-2`, chosen.id).name).toBe(chosen.name);
    expect(faceFor(seat, `${seat}-2`, chosen.id)).toBe(chosen.face);
    expect(arrivalFor(seat, `${seat}-2`, chosen.id)).toBe(chosen.arrival);
  });

  it("still reads an old record, which has a generation and nothing else", () => {
    const seat = NAMED_AGENTS[0].id;
    expect(profileFor(seat, `${seat}-2`).name).toBe(REPLACEMENTS[0].name);
    expect(profileFor(seat, `${seat}-2`, null).name).toBe(REPLACEMENTS[0].name);
  });

  it("keeps an original in its seat whatever occupant is passed", () => {
    const seat = NAMED_AGENTS[0].id;
    expect(profileFor(seat, `${seat}-1`, "vex").name).toBe(NAMED_AGENTS[0].name);
    expect(faceFor(seat, `${seat}-1`, "vex")).toBeNull();
  });
});
