import { describe, expect, it } from "vitest";
import { swingMeters } from "./bankrollMeter";

// The meter quantises to a thousandth. A bar is at most a few dozen pixels
// wide, so finer than that is not drawable, and the integer division keeps a
// very large swing from losing precision through a float.
describe("swingMeters", () => {
  it("is proportional to the change beside it", () => {
    // The defect this replaces: the meter was balance / largest balance. The
    // agents are funded identically, so at a stake of 100 wei against a
    // balance of 999999999999800 wei every bar filled to thirteen significant
    // figures of the same number. +0, -100 and +2400 drew the same bar.
    const m = swingMeters([
      { agentId: "winner", changeWei: 2400n },
      { agentId: "loser", changeWei: -100n },
      { agentId: "holder", changeWei: 0n },
    ]);
    expect(m.get("winner")).toBe(1);
    expect(m.get("loser")).toBeCloseTo(100 / 2400, 3);
    expect(m.get("holder")).toBe(0);
  });

  it("uses the largest absolute swing as full scale, whichever direction it is", () => {
    const m = swingMeters([
      { agentId: "a", changeWei: -900n },
      { agentId: "b", changeWei: 300n },
    ]);
    expect(m.get("a")).toBe(1);
    expect(m.get("b")).toBeCloseTo(1 / 3, 3);
  });

  it("is all zero when nothing moved, rather than all full", () => {
    const m = swingMeters([{ agentId: "a", changeWei: 0n }, { agentId: "b", changeWei: 0n }]);
    expect(m.get("a")).toBe(0);
    expect(m.get("b")).toBe(0);
  });

  it("handles a single agent", () => {
    expect(swingMeters([{ agentId: "only", changeWei: -5n }]).get("only")).toBe(1);
  });

  it("stays inside 0 and 1 for very large swings", () => {
    const m = swingMeters([
      { agentId: "a", changeWei: 10n ** 30n },
      { agentId: "b", changeWei: -1n },
    ]);
    expect(m.get("a")).toBe(1);
    // One wei against 10^30 is an empty bar, not a sliver. Below a
    // thousandth there is nothing to draw.
    expect(m.get("b")).toBe(0);
  });

  it("is empty for no agents", () => {
    expect(swingMeters([]).size).toBe(0);
  });
});
