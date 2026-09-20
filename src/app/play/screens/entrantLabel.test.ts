import { describe, expect, it } from "vitest";
import { entrantLabel } from "./entrantLabel";

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

  it("leaves a house bot alone, because bot-12 is its name", () => {
    expect(entrantLabel("bot-12", agents)).toBe("bot-12");
    expect(entrantLabel("bot-00", agents)).toBe("bot-00");
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
