// Slot reel tuning. All three reels spin the same 16 face strip (the roster,
// weighted by tier). Reel 1 picks the character. Reel 2's face picks an
// ability modifier from its tier's table. Reel 3's face picks a stat roll
// from its tier's range. Matching faces across reels pay the combo bonus.
// Everything here is data so it can be tuned without a code change.

import type { Tier } from "./roster";

export interface Modifier {
  readonly id: string;
  readonly hpPct: number;
  readonly atkPct: number;
  readonly defPct: number;
  /** Extra tiles moved per tick. */
  readonly spd: number;
}

export interface StatRollRange {
  min: number;
  max: number;
}

export interface ReelConfig {
  /** Share of the strip each tier occupies. Integers, any scale. */
  tierWeights: Record<Tier, number>;
  /** Reel 2 tables, indexed by the face's position inside its tier. */
  modifiers: Record<Tier, readonly Modifier[]>;
  /** Reel 3 percent bonus to all stats, spread evenly across the tier's faces. */
  statRoll: Record<Tier, StatRollRange>;
  /** Percent bonus to all stats for matching faces. */
  combos: { pair: number; threeOfAKind: number };
}

export const DEFAULT_REELS: ReelConfig = {
  tierWeights: { common: 70, uncommon: 25, rare: 5 },
  modifiers: {
    common: [
      { id: "sturdy", hpPct: 10, atkPct: 0, defPct: 0, spd: 0 },
      { id: "sharp", hpPct: 0, atkPct: 10, defPct: 0, spd: 0 },
      { id: "guarded", hpPct: 0, atkPct: 0, defPct: 20, spd: 0 },
      { id: "nimble", hpPct: 0, atkPct: 0, defPct: 0, spd: 1 },
    ],
    uncommon: [
      { id: "brawler", hpPct: 15, atkPct: 15, defPct: 0, spd: 0 },
      { id: "bulwark", hpPct: 25, atkPct: 0, defPct: 25, spd: 0 },
      { id: "swift", hpPct: 0, atkPct: 10, defPct: 0, spd: 1 },
    ],
    rare: [
      { id: "berserk", hpPct: 20, atkPct: 40, defPct: 0, spd: 0 },
      { id: "titan", hpPct: 50, atkPct: 10, defPct: 30, spd: 0 },
      { id: "phantom", hpPct: 10, atkPct: 20, defPct: 10, spd: 2 },
    ],
  },
  statRoll: {
    common: { min: 0, max: 10 },
    uncommon: { min: 10, max: 25 },
    rare: { min: 25, max: 50 },
  },
  combos: { pair: 10, threeOfAKind: 60 },
};
