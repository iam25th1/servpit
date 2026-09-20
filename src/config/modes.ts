// Game modes on the select screen. Only Battle Royale is playable; the rest
// render as locked cards with a roadmap label and are not clickable. They are
// listed rather than hidden so the player can see where this is going.

export type StakeTierId = "low" | "high";

export interface StakeOption {
  id: StakeTierId;
  label: string;
  /** Stake per entrant in integer minor units, matching the engine config. */
  minorUnits: number;
}

export interface GameMode {
  id: string;
  name: string;
  blurb: string;
  /** Locked modes are shown, labelled and inert. */
  locked: boolean;
  roadmap?: string;
  stakes?: readonly StakeOption[];
  entrants?: number;
}

export const GAME_MODES: readonly GameMode[] = Object.freeze([
  {
    id: "battleRoyale",
    name: "Battle Royale",
    blurb: "Twenty four enter the pit. One walks out with the pot.",
    locked: false,
    entrants: 24,
    stakes: [
      { id: "low", label: "Low", minorUnits: 100 },
      { id: "high", label: "High", minorUnits: 1000 },
    ],
  },
  { id: "gauntlet", name: "Gauntlet", blurb: "Survive successive waves, banking or pressing on after each.", locked: true, roadmap: "Next" },
  { id: "duel", name: "Duel", blurb: "One against one, best of three, no house bots.", locked: true, roadmap: "Next" },
  { id: "placement", name: "Placement", blurb: "Paid by finishing position rather than winner takes all.", locked: true, roadmap: "Later" },
  { id: "highRoller", name: "High Roller", blurb: "Bigger allocations, smaller fields, longer odds.", locked: true, roadmap: "Later" },
]);

export const playableModes = (): GameMode[] => GAME_MODES.filter((m) => !m.locked);
