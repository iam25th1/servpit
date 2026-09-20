import { describe, expect, it } from "vitest";
import { entrantNames } from "./entrantNames";

describe("entrantNames", () => {
  it("maps each entering agent's entrant id to its display name", () => {
    // The renderer works in entrant ids and the engine knows nothing about
    // agents, so this mapping is what lets the arena draw "Delta" over a
    // fighter the resolver calls "agent-delta".
    const names = entrantNames([
      { agentId: "delta", entrantId: "agent-delta" },
      { agentId: "atlas", entrantId: "agent-atlas" },
    ], [
      { agentId: "delta", name: "Delta" },
      { agentId: "atlas", name: "Atlas" },
      { agentId: "comet", name: "Comet" },
    ]);
    expect(names).toEqual({ "agent-delta": "Delta", "agent-atlas": "Atlas" });
  });

  it("leaves out an agent that did not enter, because it is not in the pit", () => {
    const names = entrantNames([{ agentId: "delta", entrantId: "agent-delta" }], [
      { agentId: "delta", name: "Delta" },
      { agentId: "comet", name: "Comet" },
    ]);
    expect(names).not.toHaveProperty("agent-comet");
    expect(Object.keys(names)).toEqual(["agent-delta"]);
  });

  it("names no house bot, because a bot has no name of its own", () => {
    const names = entrantNames([{ agentId: "delta", entrantId: "agent-delta" }], [{ agentId: "delta", name: "Delta" }]);
    expect(names["bot-07"]).toBeUndefined();
  });

  it("skips an entrant whose decision carries no usable name rather than writing an empty label", () => {
    const names = entrantNames([
      { agentId: "delta", entrantId: "agent-delta" },
      { agentId: "ghost", entrantId: "agent-ghost" },
    ], [
      { agentId: "delta", name: "Delta" },
      { agentId: "ghost", name: "   " },
    ]);
    expect(names).toEqual({ "agent-delta": "Delta" });
  });

  it("is empty when nobody entered", () => {
    expect(entrantNames([], [{ agentId: "delta", name: "Delta" }])).toEqual({});
  });
});
