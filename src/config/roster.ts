// Locked asset roster. Data, not constants: the engine and the extraction
// script both iterate this list, so a roster change is a one line edit here.

export type Tier = "common" | "uncommon" | "rare";

export const TIERS: readonly Tier[] = ["common", "uncommon", "rare"];

export interface RosterEntry {
  readonly id: string;
  readonly tier: Tier;
  /** Folder inside the Ninja Adventure pack, relative to the pack root. */
  readonly sourceFolder: string;
}

const character = (id: string, tier: Tier): RosterEntry => ({
  id,
  tier,
  sourceFolder: `Actor/Character/${id}`,
});

const monster = (id: string): RosterEntry => ({
  id,
  tier: "rare",
  sourceFolder: `Actor/Monster/${id}`,
});

export const ROSTER: readonly RosterEntry[] = Object.freeze([
  character("NinjaRed", "common"),
  character("NinjaBlue", "common"),
  character("Knight", "common"),
  character("Monk", "common"),
  character("Hunter", "common"),
  character("Boy", "common"),
  character("Eskimo", "common"),
  character("Caveman", "common"),
  character("NinjaDark", "uncommon"),
  character("NinjaFire", "uncommon"),
  character("NinjaWater", "uncommon"),
  character("KnightGold", "uncommon"),
  character("GladiatorBlue", "uncommon"),
  monster("Dragon"),
  monster("Cyclope"),
  monster("Bear"),
]);

/** Animations copied for character (non monster) entries, in manifest order. */
export const CHARACTER_ANIMATIONS = ["Idle", "Walk", "Attack", "Dead"] as const;

/**
 * A face with no fighter behind it.
 *
 * Marrow never enters the pit, so it is not in the ROSTER: putting it there
 * would give the lender a tier, a win rate and a place on the reels. All it
 * needs is a portrait, so only Faceset.png is extracted for these.
 */
export interface PortraitEntry {
  readonly id: string;
  /** Folder inside the Ninja Adventure pack, relative to the pack root. */
  readonly sourceFolder: string;
}

/** Marrow, the lender. A gold raccoon the size of a boss, which is the idea. */
export const PORTRAITS: readonly PortraitEntry[] = Object.freeze([{ id: "Marrow", sourceFolder: "Actor/Boss/GiantRacoonGold" }]);
