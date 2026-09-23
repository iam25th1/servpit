import { describe, expect, it } from "vitest";
import { firstOwner, handleState, suggestionsFor, type HandleOwners } from "./handles";

const log = (claims: Record<string, string>): HandleOwners => ({ owner: (handle) => claims[handle] ?? null });

describe("where a handle stands", () => {
  it("is free when nobody holds it", () => {
    expect(handleState("ash", "hash-a", log({}))).toBe("free");
  });

  it("is yours when your own browser holds it, which is the ordinary case", () => {
    // Coming back to your own handle must never read as a refusal.
    expect(handleState("ash", "hash-a", log({ ash: "hash-a" }))).toBe("yours");
  });

  it("is taken when another browser holds it", () => {
    expect(handleState("ash", "hash-b", log({ ash: "hash-a" }))).toBe("taken");
  });
});

describe("one handle to one browser, across both logs", () => {
  it("finds the claim wherever it was made", () => {
    // A handle claimed by pulling the lever was invisible to the pick log,
    // so somebody else could back under it. Both are asked now.
    expect(firstOwner("ash", [log({}), log({ ash: "hash-a" })])).toBe("hash-a");
    expect(firstOwner("ash", [log({ ash: "hash-a" }), log({})])).toBe("hash-a");
    expect(firstOwner("ash", [log({}), log({})])).toBeNull();
  });

  it("keeps the first claim when the logs disagree", () => {
    expect(firstOwner("ash", [log({ ash: "hash-a" }), log({ ash: "hash-b" })])).toBe("hash-a");
  });
});

describe("what to offer somebody whose handle is taken", () => {
  const nothingTaken = () => false;

  it("offers names near the one they wanted", () => {
    expect(suggestionsFor("ash", nothingTaken)).toEqual(["ash-2", "ash-3", "ash_x"]);
  });

  it("skips the ones that are also taken", () => {
    const taken = (candidate: string) => ["ash-2", "ash_x"].includes(candidate);
    expect(suggestionsFor("ash", taken)).toEqual(["ash-3", "ash-pit", "ash-one"]);
  });

  it("gives the same visitor the same names twice", () => {
    expect(suggestionsFor("ash", nothingTaken)).toEqual(suggestionsFor("ash", nothingTaken));
  });

  it("never offers a name that is not a handle", () => {
    for (const candidate of suggestionsFor("a-very-long-handle", nothingTaken)) {
      expect(candidate).toMatch(/^[a-z0-9_-]{3,16}$/);
    }
  });

  it("never offers the name they already tried", () => {
    expect(suggestionsFor("ash", nothingTaken)).not.toContain("ash");
  });

  it("finds something even when everything near the name is gone", () => {
    const taken = (candidate: string) => candidate.startsWith("ash");
    const out = suggestionsFor("ash", taken);
    expect(out).toHaveLength(3);
    for (const candidate of out) expect(candidate).toMatch(/^fighter-\d+$/);
  });

  it("falls back to a usable name when the request is not one", () => {
    const out = suggestionsFor("!!", nothingTaken);
    expect(out).toHaveLength(3);
    for (const candidate of out) expect(candidate).toMatch(/^[a-z0-9_-]{3,16}$/);
  });
});
