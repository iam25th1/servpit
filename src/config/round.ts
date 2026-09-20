// Round level tuning: base stats per tier, arena, storm, stakes and rake.
// Base stats are tuned so win rate lands near rare 2.5x, uncommon 1.2x and
// common 0.85x of the 1 / entrants baseline (see round.test.ts).
// The mode is a strategy object; swap it here to change the game.

import { battleRoyale } from "@/engine/modes/battleRoyale";
import type { RoundMode } from "@/engine/modes/types";
import { DEFAULT_REELS, type ReelConfig } from "./reels";
import type { Tier } from "./roster";

export interface StatBlock {
  hp: number;
  atk: number;
  def: number;
  /** Tiles moved per tick. */
  spd: number;
}

export type StakeTier = "low" | "high";

export interface RoundConfig {
  reels: ReelConfig;
  baseStats: Record<Tier, StatBlock>;
  arena: { width: number; height: number };
  /** Ticks before the storm starts. */
  maxTicks: number;
  /** Storm damage per tick, multiplied by ticks since it started. */
  stormDamage: number;
  /** Attack damage varies by plus or minus this percent. */
  damageVariancePct: number;
  minDamage: number;
  mode: RoundMode;
  /** Stake per entrant in integer minor units, by tier. */
  stakeTiers: Record<StakeTier, number>;
  stakeTier: StakeTier;
  /** House rake in basis points (0 to 10000). */
  rakeBps: number;
}

export const DEFAULT_ROUND: RoundConfig = {
  reels: DEFAULT_REELS,
  baseStats: {
    common: { hp: 100, atk: 12, def: 2, spd: 1 },
    uncommon: { hp: 115, atk: 12, def: 2, spd: 1 },
    rare: { hp: 125, atk: 13, def: 3, spd: 1 },
  },
  arena: { width: 24, height: 24 },
  maxTicks: 300,
  stormDamage: 5,
  damageVariancePct: 20,
  minDamage: 1,
  mode: battleRoyale,
  stakeTiers: { low: 100, high: 1000 },
  stakeTier: "low",
  rakeBps: 0,
};
