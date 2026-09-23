// What the lineup shows while the agents are still deciding.
//
// Every agent has a row from the moment the round starts, because an empty
// panel says nothing and the panel used to stay empty for 61 seconds. A row
// is either waiting or decided, and the roster is known up front, so the
// shape of the list never changes as answers land: rows fill in, they do not
// appear.

import { NAMED_AGENTS } from "@/config/agents";

/** Who is in a seat, before that seat has decided anything. */
export interface OccupantShape {
  agentId: string;
  name: string;
  face?: string | null;
}

export interface DecidedShape {
  agentId: string;
  name: string;
  enter: boolean;
  stake: number;
  reason: string;
  /** Chips in the wallet. Absent on a decision streamed before the bank existed. */
  balance?: number;
  /** Chips owed to the lender. Zero or absent when it owes nothing. */
  debt?: number;
  /** The roster face for a replacement. Null or absent for the originals. */
  face?: string | null;
  /**
   * Whether a model answered or the deterministic fallback did.
   *
   * Shown, because a line written by the fallback must never read as though
   * an agent reasoned its way to it. Absent on a decision streamed before
   * this was carried.
   */
  source?: "serv" | "learned" | "heuristic";
}

export type LineupRow =
  | { agentId: string; name: string; face: string | null; state: "waiting" }
  | { agentId: string; name: string; face: string | null; state: "decided"; decision: DecidedShape };

/**
 * One row per seat in roster order, whatever order the answers arrived in.
 *
 * Roster order rather than arrival order, because a list that reorders itself
 * as replies land is harder to read than one that fills in place.
 *
 * The name is the occupant's, never the seat's. A seat outlives the agent in
 * it: the wallet is reused and somebody new sits down. This used to read the
 * name straight off the roster, so a replacement's row carried the name of
 * the agent it replaced, under the replacement's own face.
 */
export function lineupRows(decided: readonly DecidedShape[], occupants: readonly OccupantShape[] = []): LineupRow[] {
  const byId = new Map(decided.map((d) => [d.agentId, d]));
  const seated = new Map(occupants.map((o) => [o.agentId, o]));
  return NAMED_AGENTS.map((profile) => {
    const decision = byId.get(profile.id);
    const occupant = seated.get(profile.id);
    // The decision is the freshest thing the client has: it comes from the
    // round being planned now. The occupant line arrives before it and the
    // roster is the fallback for a seat nobody has spoken for yet.
    const name = decision?.name ?? occupant?.name ?? profile.name;
    const face = decision?.face ?? occupant?.face ?? null;
    return decision ? { agentId: profile.id, name, face, state: "decided" as const, decision } : { agentId: profile.id, name, face, state: "waiting" as const };
  });
}

/** How many have reported, for the progress line. */
export function decidedCount(rows: readonly LineupRow[]): number {
  return rows.filter((r) => r.state === "decided").length;
}
