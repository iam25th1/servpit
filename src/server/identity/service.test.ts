import { describe, expect, it } from "vitest";
import { tokenHash } from "../backing/identity";
import type { HandleOwners } from "./handles";
import { lookUpHandle, ownerAcross } from "./service";

const TOKEN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const log = (claims: Record<string, string>): HandleOwners => ({ owner: (handle) => claims[handle] ?? null });

describe("asking about a handle", () => {
  it("says a free name is free", () => {
    const view = lookUpHandle({ handle: "ash", token: TOKEN }, { logs: [log({})] });
    expect(view).toMatchObject({ handle: "ash", state: "free", suggestions: [] });
  });

  it("says your own name is yours, rather than refusing it", () => {
    const view = lookUpHandle({ handle: "ash", token: TOKEN }, { logs: [log({ ash: tokenHash(TOKEN) })] });
    expect(view.state).toBe("yours");
    expect(view.message).toMatch(/yours on this browser/);
  });

  it("says a taken name is taken, and offers names that are not", () => {
    const view = lookUpHandle({ handle: "ash", token: OTHER }, { logs: [log({ ash: tokenHash(TOKEN) })] });
    expect(view.state).toBe("taken");
    expect(view.message).toMatch(/belongs to another browser/);
    expect(view.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of view.suggestions) expect(suggestion).not.toBe("ash");
  });

  it("looks in every log, so a name claimed by pulling is claimed", () => {
    const view = lookUpHandle({ handle: "ash", token: OTHER }, { logs: [log({}), log({ ash: tokenHash(TOKEN) })] });
    expect(view.state).toBe("taken");
  });

  it("never offers a name that is already held", () => {
    const claims: Record<string, string> = { ash: tokenHash(TOKEN), "ash-2": tokenHash(TOKEN), "ash-3": tokenHash(TOKEN) };
    const view = lookUpHandle({ handle: "ash", token: OTHER }, { logs: [log(claims)] });
    for (const suggestion of view.suggestions) expect(claims[suggestion]).toBeUndefined();
  });

  it("says what is wrong with a name that is not one", () => {
    const view = lookUpHandle({ handle: "no", token: TOKEN }, { logs: [log({})] });
    expect(view).toMatchObject({ handle: null, state: null, suggestions: [] });
    expect(view.message).toMatch(/3 to 16/);
  });

  it("says nothing about a browser with no token", () => {
    const view = lookUpHandle({ handle: "ash", token: "" }, { logs: [log({})] });
    expect(view.state).toBeNull();
  });
});

describe("a handle claimed anywhere is claimed", () => {
  it("finds the owner across every log", () => {
    const owner = ownerAcross([log({}), log({ ash: "hash-from-the-lever" }), log({ ash: "hash-from-a-seat" })]);
    expect(owner("ash")).toBe("hash-from-the-lever");
    expect(owner("nobody")).toBeNull();
  });
});
