import { describe, expect, it } from "vitest";
import { battleRoyale } from "./battleRoyale";

describe("battleRoyale mode", () => {
  it("accepts 16 to 32 entrants", () => {
    expect(battleRoyale.id).toBe("battleRoyale");
    expect(battleRoyale.minEntrants).toBe(16);
    expect(battleRoyale.maxEntrants).toBe(32);
  });

  it("winner takes the whole prize, everyone else gets zero", () => {
    const placements = ["w", "second", "third"];
    const payouts = battleRoyale.distribute(1_500, placements);
    expect(payouts).toEqual([
      { entrantId: "w", amount: 1_500 },
      { entrantId: "second", amount: 0 },
      { entrantId: "third", amount: 0 },
    ]);
  });
});
