// What the lineup shows while the agents are still deciding.
//
// Every agent has a row from the moment the round starts, because an empty
// panel says nothing and the panel used to stay empty for 61 seconds. A row
// is either waiting or decided, and the roster is known up front, so the
// shape of the list never changes as answers land: rows fill in, they do not
// appear.

import { NAMED_AGENTS } from "@/config/agents";

export interface DecidedShape {
  agentId: string;
  name: string;
  enter: boolean;
  stake: number;
  reason: string;
}

export type LineupRow =
  | { agentId: string; name: string; state: "waiting" }
  | { agentId: string; name: string; state: "decided"; decision: DecidedShape };

/**
 * One row per agent in roster order, whatever order the answers arrived in.
 *
 * Roster order rather than arrival order, because a list that reorders itself
 * as replies land is harder to read than one that fills in place.
 */
export function lineupRows(decided: readonly DecidedShape[]): LineupRow[] {
  const byId = new Map(decided.map((d) => [d.agentId, d]));
  return NAMED_AGENTS.map((profile) => {
    const decision = byId.get(profile.id);
    return decision
      ? { agentId: profile.id, name: profile.name, state: "decided" as const, decision }
      : { agentId: profile.id, name: profile.name, state: "waiting" as const };
  });
}

/** How many have reported, for the progress line. */
export function decidedCount(rows: readonly LineupRow[]): number {
  return rows.filter((r) => r.state === "decided").length;
}
