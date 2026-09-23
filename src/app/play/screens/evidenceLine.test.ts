import { describe, expect, it } from "vitest";
import { evidenceLine, recordLine } from "./evidenceLine";

describe("what a learned decision was drawn from", () => {
  it("says the rounds, what the model did in them, and the usual stake", () => {
    expect(evidenceLine({ matches: 7, entered: 6, typicalStake: 20 }, 10)).toBe("Learned from 7 reasoned rounds in spots like this. SERV entered in 6, typical stake 2x.");
  });

  it("gives the stake in chips when it is not a whole number of seats", () => {
    expect(evidenceLine({ matches: 7, entered: 6, typicalStake: 15 }, 10)).toBe("Learned from 7 reasoned rounds in spots like this. SERV entered in 6, typical stake 15 chips.");
  });

  it("leaves the stake out when the model never entered", () => {
    expect(evidenceLine({ matches: 6, entered: 0, typicalStake: 0 }, 10)).toBe("Learned from 6 reasoned rounds in spots like this. SERV entered in 0.");
  });

  it("counts one round as one round", () => {
    expect(evidenceLine({ matches: 1, entered: 1, typicalStake: 10 }, 10)).toContain("1 reasoned round in spots like this");
  });

  it("says nothing at all without evidence", () => {
    expect(evidenceLine(undefined, 10)).toBeNull();
    expect(evidenceLine({ matches: 0, entered: 0, typicalStake: 0 }, 10)).toBeNull();
  });

  it("never mentions how any of those rounds ended", () => {
    // The learner reads decisions and not outcomes, so nothing here may
    // imply a win or a loss had anything to do with it.
    const line = evidenceLine({ matches: 9, entered: 5, typicalStake: 10 }, 10) ?? "";
    for (const word of ["won", "win", "lost", "loss", "profit", "ahead"]) expect(line.toLowerCase()).not.toContain(word);
  });
});

describe("what the pit says about its own record", () => {
  it("says how many reasoned rounds it has to learn from", () => {
    expect(recordLine(42)).toBe("The pit has 42 reasoned rounds to learn from.");
    expect(recordLine(1)).toBe("The pit has 1 reasoned round to learn from.");
  });

  it("says nothing before it has any", () => {
    expect(recordLine(0)).toBeNull();
    expect(recordLine(undefined)).toBeNull();
  });
});
