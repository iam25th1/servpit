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
