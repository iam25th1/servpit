import { describe, expect, it } from "vitest";
import { NAMED_AGENTS } from "@/config/agents";
import { decidedCount, lineupRows } from "./lineupRows";

const decision = (agentId: string, enter = true) => ({ agentId, name: agentId, enter, stake: enter ? 100 : 0, reason: "because" });

describe("lineupRows", () => {
  it("gives every agent a row before any of them has answered", () => {
    // The panel used to be empty for 61 seconds. Six waiting rows say the
    // round has started; nothing says nothing.
    const rows = lineupRows([]);
    expect(rows).toHaveLength(NAMED_AGENTS.length);
    expect(rows.every((r) => r.state === "waiting")).toBe(true);
    expect(decidedCount(rows)).toBe(0);
  });

  it("fills a row in place when that agent reports", () => {
    const rows = lineupRows([decision(NAMED_AGENTS[2].id)]);
    expect(rows[2].state).toBe("decided");
    expect(rows.filter((r) => r.state === "waiting")).toHaveLength(NAMED_AGENTS.length - 1);
    expect(decidedCount(rows)).toBe(1);
  });

  it("keeps roster order however the answers arrived", () => {
    // A list that reorders itself as replies land is harder to read than one
    // that fills in place.
    const reversed = [...NAMED_AGENTS].reverse().map((p) => decision(p.id));
    expect(lineupRows(reversed).map((r) => r.agentId)).toEqual(NAMED_AGENTS.map((p) => p.id));
  });

  it("carries the decision through so the row can show it", () => {
    const rows = lineupRows([decision(NAMED_AGENTS[0].id, false)]);
    const row = rows[0];
    expect(row.state === "decided" && row.decision.enter).toBe(false);
    expect(row.state === "decided" && row.decision.reason).toBe("because");
  });

  it("ignores an id that is not on the roster rather than growing the list", () => {
    const rows = lineupRows([decision("ghost")]);
    expect(rows).toHaveLength(NAMED_AGENTS.length);
    expect(decidedCount(rows)).toBe(0);
  });

  it("is all decided once every agent has reported", () => {
    const rows = lineupRows(NAMED_AGENTS.map((p) => decision(p.id)));
    expect(decidedCount(rows)).toBe(NAMED_AGENTS.length);
  });
});
