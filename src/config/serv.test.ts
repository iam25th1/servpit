import { describe, expect, it } from "vitest";
import { FORBIDDEN_WORDS } from "@/server/decisions/decide";
import { DEFAULT_SERV, servModelId } from "./serv";

describe("the Shadow Agent criteria", () => {
  it("assert a non negative whole stake within what the operator holds", () => {
    // Shadow Agent is the second net. When the schema stopped being able to
    // carry the bound, these had to keep carrying it.
    const hint = DEFAULT_SERV.shadowHint.toLowerCase();
    expect(hint).toContain("non negative whole number of chips");
    expect(hint).toContain("never below zero");
    expect(hint).toContain("never greater than the chips the operator holds");
    expect(hint).toContain("exactly zero when enter is false");
  });

  it("ask SERV to reject and regenerate the wording the player must never see", () => {
    // The same list the independent validator checks. Shadow Agent gets the
    // chance to fix it before a reply comes back; the validator is what
    // guarantees a violation never reaches the screen.
    const hint = DEFAULT_SERV.shadowHint.toLowerCase();
    for (const word of FORBIDDEN_WORDS) expect(hint).toContain(word);
    expect(hint).toContain("number longer than four digits");
    expect(hint).toContain("at most twenty words");
  });

  it("are prose, not schema syntax, so the validator never sees them", () => {
    // The 400 was on response_format.json_schema.schema. Expressing these as
    // a JSON Schema would have put them in the rejected path too.
    expect(DEFAULT_SERV.shadowHint).not.toContain("minimum");
    expect(DEFAULT_SERV.shadowHint).not.toContain('"type"');
  });
});

describe("the features the request enables", () => {
  it("is Prompt Guard, Shadow Agent and Multipath on, Kronos off, as phase 3 specified", () => {
    expect(DEFAULT_SERV.features).toEqual({ promptGuard: true, shadowAgent: true, multipath: true, kronos: false });
  });

  it("puts Multipath on the model id and leaves Kronos off it", () => {
    expect(servModelId(DEFAULT_SERV)).toBe("claude-haiku-4.5-serv-multipath");
    expect(servModelId({ ...DEFAULT_SERV, features: { ...DEFAULT_SERV.features, kronos: true } })).toBe("claude-haiku-4.5-serv-multipath-serv-kronos");
  });
});
