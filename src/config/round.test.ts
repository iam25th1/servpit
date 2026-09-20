import { describe, expect, it } from "vitest";
import { DEFAULT_ROUND } from "./round";
import { TIERS, type Tier } from "./roster";
import { resolveRound } from "@/engine/resolveRound";

// Balance target from the PR #1 review: rare 2 to 3x the 1 / entrants
// baseline, uncommon about 1.2x, common no worse than 0.6x. Deterministic
// seeds, so this is a regression lock on the base stats, not a flaky stat.
describe("tier balance", () => {
  const ROUNDS = 500;
  const ENTRANTS = 24;
  const entrants = Array.from({ length: ENTRANTS }, (_, i) => ({ id: `p${i}` }));
  const appearances: Record<Tier, number> = { common: 0, uncommon: 0, rare: 0 };
  const wins: Record<Tier, number> = { common: 0, uncommon: 0, rare: 0 };
  for (let i = 0; i < ROUNDS; i++) {
    const r = resolveRound(`balance-${i}`, entrants, DEFAULT_ROUND);
    for (const c of r.characters) {
      appearances[c.tier]++;
      if (c.entrantId === r.placements[0]) wins[c.tier]++;
    }
  }
  const multiple = (tier: Tier) => wins[tier] / appearances[tier] / (1 / ENTRANTS);

  it("every tier appears", () => {
    for (const tier of TIERS) expect(appearances[tier]).toBeGreaterThan(0);
  });

  it("rare wins 2 to 3 times the baseline", () => {
    expect(multiple("rare")).toBeGreaterThanOrEqual(2);
    expect(multiple("rare")).toBeLessThanOrEqual(3);
  });

  it("uncommon wins about 1.2 times the baseline", () => {
    expect(multiple("uncommon")).toBeGreaterThanOrEqual(1);
    expect(multiple("uncommon")).toBeLessThanOrEqual(1.45);
  });

  it("common wins no worse than 0.6 times the baseline", () => {
    expect(multiple("common")).toBeGreaterThanOrEqual(0.6);
  });
});
