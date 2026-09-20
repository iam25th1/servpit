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

import { createRng } from "../rng";

describe("battleRoyale guards", () => {
  it("refuses a context whose storm could never end the round", () => {
    const stats = { hp: 10, atk: 1, def: 0, spd: 1 };
    const combatants = ["a", "b"].map((id) => ({
      entrantId: id,
      characterId: "Knight",
      tier: "common" as const,
      stats,
      modifierId: "none",
      statRollPct: 0,
      combo: "none" as const,
      bonusPct: 0,
    }));
    const ctx = { rng: createRng("guard"), combatants, arena: { width: 8, height: 8 }, maxTicks: 1, stormDamage: 0, damageVariancePct: 0, minDamage: 1 };
    expect(() => battleRoyale.simulate(ctx)).toThrow(RangeError);
  });
});
