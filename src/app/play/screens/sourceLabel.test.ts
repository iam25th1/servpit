import { describe, expect, it } from "vitest";
import { sourceLabel } from "./sourceLabel";

describe("what an answer is called", () => {
  it("calls a model's answer reasoned", () => {
    expect(sourceLabel("serv")).toEqual({ text: "reasoned", tone: "reasoned" });
  });

  it("calls a drawn answer learned, and never reasoned", () => {
    // The pit repeating what a model decided in a spot like this is not the
    // pit thinking, and a viewer told otherwise is being told something
    // untrue about a money surface.
    const label = sourceLabel("learned");
    expect(label).toEqual({ text: "learned", tone: "learned" });
    expect(label?.text).not.toBe("reasoned");
    expect(label?.tone).not.toBe("reasoned");
  });

  it("calls the fixed rule what it is", () => {
    expect(sourceLabel("heuristic")).toEqual({ text: "on instinct", tone: "instinct" });
  });

  it("never calls something it does not recognise reasoned", () => {
    for (const source of ["", "SERV", "serv-multipath", "guessed", "something new"]) {
      expect(sourceLabel(source)?.text).not.toBe("reasoned");
    }
  });

  it("says nothing at all about a decision that has not arrived", () => {
    expect(sourceLabel(undefined)).toBeNull();
    expect(sourceLabel(null)).toBeNull();
  });
});
