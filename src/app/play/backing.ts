// What the pick interface draws, worked out from the round it is drawn over.
//
// Pure, so the whole mapping is testable without a browser. The options are
// the agents that actually bought in, each with what it drew, because backing
// a fighter you have not seen is a coin toss with extra steps.
//
// The award shown after the result is computed with the same function the
// server settles with, from the same counts, so what a viewer reads and what
// the board records cannot drift.

import { pointsFor } from "@/config/backing";
import type { ArenaFeedRound } from "./arenaScreens";

export interface BackOption {
  agentId: string;
  name: string;
  face: string | null;
  /** What the reels gave this agent, when the draw has happened. */
  characterId: string | null;
  tier: string | null;
  /** How many viewers have backed it so far. */
  backers: number;
}

/** The entrant id an agent fights under, which is what a result names. */
export function entrantIdOf(agentId: string): string {
  return `agent-${agentId}`;
}

/** Who may be backed: the agents that paid into this round, with their draw. */
export function backOptions(round: ArenaFeedRound | null, counts: Record<string, number>): BackOption[] {
  if (!round) return [];
  const drawn = new Map((round.reels ?? []).map((pull) => [pull.entrantId, pull]));
  return round.entries.map((entry) => {
    const decision = round.decisions.find((d) => d.agentId === entry.agentId);
    const pull = drawn.get(entrantIdOf(entry.agentId));
    return {
      agentId: entry.agentId,
      name: decision?.name ?? entry.agentId,
      face: decision?.face ?? null,
      characterId: pull?.characterId ?? null,
      tier: pull?.tier ?? null,
      backers: counts[entry.agentId] ?? 0,
    };
  });
}

/**
 * How this viewer's call went, or null when they did not make one.
 *
 * Only once the round has a result. Before that there is nothing to say, and
 * saying it early would be saying the winner early.
 */
export function pickOutcome(
  round: ArenaFeedRound | null,
  pick: string | null,
  counts: Record<string, number>,
): { pick: string; won: boolean; points: number } | null {
  if (!round?.result || !pick) return null;
  const winner = typeof round.result.winner === "string" ? round.result.winner : "";
  const backers = Object.values(counts).reduce((total, n) => total + n, 0);
  const correct = counts[winner.replace(/^agent-/, "")] ?? 0;
  const won = entrantIdOf(pick) === winner;
  return { pick, won, points: won ? pointsFor(backers, correct) : 0 };
}
