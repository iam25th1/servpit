import { describe, expect, it } from "vitest";
import { entrantLabel, houseLabel, roundNames } from "./entrantLabel";

const agents = [
  { agentId: "delta", name: "Delta" },
  { agentId: "atlas", name: "Atlas" },
];

describe("entrantLabel", () => {
  it("gives an agent its display name", () => {
    // The kill feed rendered the raw entrant id, so the longest shot of the
    // demo read "agent-delta is out" while every other surface said "Delta".
    expect(entrantLabel("agent-delta", agents)).toBe("Delta");
    expect(entrantLabel("agent-atlas", agents)).toBe("Atlas");
  });

  it("calls a house bot by its seat in the house, because bot-12 is not a word anybody reads", () => {
    expect(entrantLabel("bot-12", agents)).toBe("House 13");
    expect(entrantLabel("bot-00", agents)).toBe("House 1");
    expect(houseLabel("bot-x")).toBeNull();
    expect(houseLabel("robot-01")).toBeNull();
  });

  it("names a claimed fighter from the round, rather than by its handle's id", () => {
    expect(entrantLabel("fighter-cupcake", agents, { "fighter-cupcake": "Muffin" })).toBe("Muffin");
  });

  it("prefers the round's own names, which know who sits in a seat now", () => {
    expect(entrantLabel("agent-delta", agents, { "agent-delta": "Brand" })).toBe("Brand");
  });

  it("falls back to the id for an agent the round did not report", () => {
    expect(entrantLabel("agent-ghost", agents)).toBe("agent-ghost");
  });

  it("does not strip the prefix off something that merely starts with it", () => {
    expect(entrantLabel("agentdelta", agents)).toBe("agentdelta");
    expect(entrantLabel("agent-", agents)).toBe("agent-");
  });

  it("handles an empty roster", () => {
    expect(entrantLabel("agent-delta", [])).toBe("agent-delta");
  });
});

describe("roundNames", () => {
  it("names every agent and claimed fighter in the round, before the fight has a result", () => {
    const names = roundNames({
      decisions: [{ agentId: "delta", name: "Delta" }],
      fighters: [{ name: "Muffin", entrantId: "fighter-cupcake" }],
      fight: { names: { "agent-atlas": "Atlas" } },
    });
    expect(names).toEqual({ "agent-delta": "Delta", "fighter-cupcake": "Muffin", "agent-atlas": "Atlas" });
  });

  it("is empty for no round at all", () => {
    expect(roundNames(null)).toEqual({});
  });
});
