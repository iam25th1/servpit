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

describe("a seat outlives the agent in it", () => {
  // The bug this covers: the row took its name from the roster, so a seat
  // whose original had been carried out showed the dead agent's name under
  // the replacement's face. One row, two identities.
  const seat = NAMED_AGENTS[0].id;
  const original = NAMED_AGENTS[0].name;

  it("shows the occupant's name and face once it has decided", () => {
    const rows = lineupRows([{ agentId: seat, name: "Onyx", enter: true, stake: 10, reason: "In.", face: "NinjaDark" }]);
    const row = rows.find((r) => r.agentId === seat)!;
    expect(row.name).toBe("Onyx");
    expect(row.name).not.toBe(original);
    expect(row.face).toBe("NinjaDark");
  });

  it("shows the occupant's name while it is still deciding", () => {
    const rows = lineupRows([], [{ agentId: seat, name: "Vex", face: "NinjaFire" }]);
    const row = rows.find((r) => r.agentId === seat)!;
    expect(row.state).toBe("waiting");
    expect(row.name).toBe("Vex");
    expect(row.face).toBe("NinjaFire");
  });

  it("prefers the decision to the occupant line, which is older", () => {
    const rows = lineupRows(
      [{ agentId: seat, name: "Tally", enter: false, stake: 0, reason: "Out.", face: "KnightGold" }],
      [{ agentId: seat, name: "Vex", face: "NinjaFire" }],
    );
    expect(rows.find((r) => r.agentId === seat)!.name).toBe("Tally");
    expect(rows.find((r) => r.agentId === seat)!.face).toBe("KnightGold");
  });

  it("falls back to the roster for a seat nobody has spoken for", () => {
    const row = lineupRows([])[0];
    expect(row.name).toBe(original);
    expect(row.face).toBeNull();
  });
});
