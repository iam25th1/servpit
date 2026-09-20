// What to call an entrant on screen.
//
// The resolver works in entrant ids: a real agent is "agent-<id>" and a
// house bot is "bot-NN". Every surface that names an agent should use the
// display name the round reported for it, and a bot has no other name than
// the one it already has.

export interface NamedAgent {
  agentId: string;
  name: string;
}

const AGENT_PREFIX = "agent-";

export function entrantLabel(entrantId: string, agents: readonly NamedAgent[]): string {
  if (!entrantId.startsWith(AGENT_PREFIX)) return entrantId;
  const id = entrantId.slice(AGENT_PREFIX.length);
  if (id.length === 0) return entrantId;
  return agents.find((a) => a.agentId === id)?.name ?? entrantId;
}
