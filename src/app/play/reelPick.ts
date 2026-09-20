// Which entrant's draw the slot machine shows. The symbols on the reels are
// always a real Pull from the resolved round, never generated for display, so
// what the player watches land is what the engine actually drew.

import type { Tier } from "@/config/roster";
import type { Combo } from "@/engine/reels";

export interface RunReel {
  entrantId: string;
  symbols: readonly [string, string, string] | string[];
  characterId: string;
  tier: Tier;
  combo: Combo;
  bonusPct: number;
}

/** The first agent seat, because those are the entrants the player is backing. */
export function pickPlayerDraw(reels: readonly RunReel[]): RunReel | null {
  return reels.find((r) => r.entrantId.startsWith("agent-")) ?? reels[0] ?? null;
}
