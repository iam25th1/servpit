// What a call was worth.
//
// Pari mutuel, which is the only split that makes backing a long shot worth
// anything: the award is the base divided by the share of this round's
// backers who made the same call. Everybody on the favourite splits it and
// gets the base each; the one viewer who called the outsider gets the base
// multiplied by the whole field. A wrong call is worth nothing, and a round
// nobody called right pays nobody.
//
// Points, never money. There is no pool of anything here, and the total
// awarded in a round is not conserved: it is a score for calling it, not a
// share of what anybody put in, because nobody put in anything.
//
// Integer arithmetic throughout and no clock, so the same round scored twice
// is the same answer twice, which is what lets a settle be repeated safely.

import { POINTS_PER_ROUND } from "@/config/backing";

export interface RoundScore {
  handle: string;
  agentId: string;
  correct: boolean;
  points: number;
}

/** The award for one correct call among this many backers. */
export function pointsFor(backers: number, correct: number): number {
  if (correct <= 0 || backers <= 0) return 0;
  // Rounded down, so the award never invents a point that the split does not
  // support, and every backer of the same agent is paid exactly the same.
  return Math.floor((POINTS_PER_ROUND * backers) / correct);
}

/**
 * Every backer's score for a round, in the order the picks were read.
 *
 * The winner is an entrant id, which for an agent is its id with a prefix.
 * A house bot winning is a valid round with no correct calls in it: bots
 * cannot be backed, so nobody scores and the leaderboard simply records the
 * picks as made and wrong.
 */
export function scoreRound(picks: ReadonlyMap<string, string>, winnerEntrantId: string): RoundScore[] {
  const backers = picks.size;
  const won = (agentId: string): boolean => `agent-${agentId}` === winnerEntrantId;
  let correct = 0;
  for (const agentId of picks.values()) if (won(agentId)) correct += 1;
  const award = pointsFor(backers, correct);
  return [...picks].map(([handle, agentId]) => ({
    handle,
    agentId,
    correct: won(agentId),
    points: won(agentId) ? award : 0,
  }));
}
