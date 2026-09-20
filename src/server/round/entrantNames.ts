// Entrant id to display name, for the surfaces that draw a fighter.
//
// The resolver works in entrant ids and the combat engine knows nothing
// about agents, so nothing downstream of it can turn "agent-delta" into
// "Delta" on its own. This is the one place that knows both, and it travels
// with the replay so the renderer never has to take an id apart.
//
// House bots are absent on purpose. A bot has no name beyond the id it
// already has, and twenty four labels in one arena is noise rather than
// information.

export interface EnteringRef {
  agentId: string;
  entrantId: string;
}

export interface NamedDecision {
  agentId: string;
  name: string;
}

export function entrantNames(entering: readonly EnteringRef[], decisions: readonly NamedDecision[]): Record<string, string> {
  const byAgent = new Map(decisions.map((d) => [d.agentId, d.name]));
  const out: Record<string, string> = {};
  for (const e of entering) {
    const name = byAgent.get(e.agentId)?.trim();
    // An empty label is worse than none: it draws a shadow with no glyphs.
    if (name === undefined || name.length === 0) continue;
    out[e.entrantId] = name;
  }
  return out;
}
