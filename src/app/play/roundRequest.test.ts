import { describe, expect, it } from "vitest";
import { runRequestFor } from "./roundRequest";

describe("runRequestFor", () => {
  it("settles the round the player was shown", () => {
    // The defect this replaces: the client asked for the plan with one seed
    // and then asked for the run with plan.roundId.replace(/^r-/, "s"). The
    // run route re-plans from the seed it is given, so the decisions on
    // screen and the transfers that settled belonged to two unrelated rounds.
    const plan = { roundId: "r-8f2c", seed: "slot-8f2c" };
    expect(runRequestFor(plan, 24)).toEqual({ seed: "slot-8f2c", entrants: 24 });
  });

  it("never derives the seed from the round id", () => {
    const plan = { roundId: "r-abc", seed: "slot-zzz" };
    const body = runRequestFor(plan, 24);
    expect(body.seed).toBe("slot-zzz");
    expect(body.seed).not.toContain("abc");
  });

  it("passes the entrant count through, because the round id encodes the seed and the count together", () => {
    expect(runRequestFor({ roundId: "r-1", seed: "s1" }, 8).entrants).toBe(8);
  });

  it("rejects a plan with no seed rather than settling a round nobody saw", () => {
    expect(() => runRequestFor({ roundId: "r-1", seed: "" }, 24)).toThrow(RangeError);
  });
});
