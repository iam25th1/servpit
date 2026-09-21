// Game modes on the select screen. Only Battle Royale is playable; the rest
// render as locked cards with a roadmap label and are not clickable. They are
// listed rather than hidden so the player can see where this is going.
//
// There is no stake tier. Two tabs, Low and High, used to sit on the playable
// card and decided nothing: the request carries a seed and an entrant count,
// so the tier never reached the server and every seat cost the same. The
// player stakes nothing of their own either, so choosing what the agents
// risk was never theirs to make. A seat costs a fixed share of what a wallet
// is funded with, set by SERVPIT_STAKE_FRACTION.

export interface GameMode {
  id: string;
  name: string;
  blurb: string;
  /** Locked modes are shown, labelled and inert. */
  locked: boolean;
  roadmap?: string;
  entrants?: number;
}

export const GAME_MODES: readonly GameMode[] = Object.freeze([
  {
    id: "battleRoyale",
    name: "Battle Royale",
    blurb: "Twenty four enter the pit. One walks out with the pot.",
    locked: false,
    entrants: 24,
  },
  { id: "gauntlet", name: "Gauntlet", blurb: "Survive successive waves, banking or pressing on after each.", locked: true, roadmap: "Next" },
  { id: "duel", name: "Duel", blurb: "One against one, best of three, no house bots.", locked: true, roadmap: "Next" },
  { id: "placement", name: "Placement", blurb: "Paid by finishing position rather than winner takes all.", locked: true, roadmap: "Later" },
  { id: "highRoller", name: "High Roller", blurb: "Bigger allocations, smaller fields, longer odds.", locked: true, roadmap: "Later" },
]);

export const playableModes = (): GameMode[] => GAME_MODES.filter((m) => !m.locked);
