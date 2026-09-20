import type { Combatant } from "../combat";
import type { RoundEvent } from "../events";
import type { Payout } from "../payout";
import type { Rng } from "../rng";

export interface FightContext {
  rng: Rng;
  /** In entrant order. Modes must not mutate these. */
  combatants: readonly Combatant[];
  arena: { width: number; height: number };
  maxTicks: number;
  stormDamage: number;
  damageVariancePct: number;
  minDamage: number;
}

/**
 * A game mode is a strategy object. The resolver validates inputs, spins the
 * reels, builds combatants, then hands off to the mode for the fight and the
 * prize split. Adding a mode means adding a file like battleRoyale.ts and
 * pointing config.mode at it. The resolver does not change.
 */
export interface RoundMode {
  readonly id: string;
  readonly minEntrants: number;
  readonly maxEntrants: number;
  /** Runs the fight. placements lists entrant ids, winner first. */
  simulate(ctx: FightContext): { log: RoundEvent[]; placements: string[] };
  /** Splits the prize (pot minus rake). Must cover every entrant and sum exactly to prize. */
  distribute(prize: number, placements: readonly string[]): Payout[];
}
