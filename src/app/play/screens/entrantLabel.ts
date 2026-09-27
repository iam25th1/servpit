// What to call an entrant on screen.
//
// The resolver works in entrant ids: a real agent is "agent-<id>", a claimed
// seat is "fighter-<handle>" and a house bot is "bot-NN". None of those is a
// word a viewer reads. Every surface that names an entrant uses the name the
// round reported for it, and a house bot is called by its seat in the house.

import { FIGHTER_PREFIX } from "@/config/fighters";

export interface NamedAgent {
  agentId: string;
  name: string;
}

const AGENT_PREFIX = "agent-";
const HOUSE = /^bot-(\d{1,3})$/;

/** A house bot by its seat number, counted from one, or null for anything else. */
export function houseLabel(entrantId: string): string | null {
  const match = HOUSE.exec(entrantId);
  return match ? `House ${Number(match[1]) + 1}` : null;
}

/**
 * The name for an entrant.
 *
 * The names map wins when it has one: it is built from the round itself, so
 * it carries the claimed fighters' names and whoever sits in a seat now. Then
 * the agents the caller has, then the house, and only then the id, which is
 * what a caller gets for something it was told nothing about.
 */
export function entrantLabel(entrantId: string, agents: readonly NamedAgent[], names: Readonly<Record<string, string>> = {}): string {
  const named = names[entrantId];
  if (named) return named;
  if (entrantId.startsWith(AGENT_PREFIX)) {
    const id = entrantId.slice(AGENT_PREFIX.length);
    if (id.length === 0) return entrantId;
    return agents.find((a) => a.agentId === id)?.name ?? entrantId;
  }
  return houseLabel(entrantId) ?? entrantId;
}

/** The slice of a round this reads. Mirrors the arena payload. */
export interface NamedRound {
  decisions?: ReadonlyArray<{ agentId: string; name: string }>;
  fighters?: ReadonlyArray<{ name: string; entrantId: string }>;
  fight?: { names?: Record<string, string> } | null;
}

/**
 * Every name the round knows, by entrant id.
 *
 * The agents from their decisions, the claimed fighters from the round's own
 * list of them, and whatever the fight itself named. Built from the round on
 * screen, so it names the fight while it is still playing, before there is a
 * result to read names from.
 */
export function roundNames(round: NamedRound | null | undefined): Record<string, string> {
  const names: Record<string, string> = {};
  if (!round) return names;
  for (const decision of round.decisions ?? []) names[`${AGENT_PREFIX}${decision.agentId}`] = decision.name;
  for (const fighter of round.fighters ?? []) {
    if (fighter.entrantId.startsWith(FIGHTER_PREFIX)) names[fighter.entrantId] = fighter.name;
  }
  for (const [id, name] of Object.entries(round.fight?.names ?? {})) if (!names[id]) names[id] = name;
  return names;
}
