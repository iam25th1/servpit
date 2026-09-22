// Scoring a finished round onto the board.
//
// Read the picks the window took, score them against the winner the round
// already has, add them to the board once. Nothing here can move money: the
// inputs are a log of names and the output is a file of numbers.
//
// Called by the worker after the result is published, so the figures a viewer
// reads and the points they earned come from the same finished round.

import { log } from "../log";
import { LeaderboardStore, leaderboardFile } from "./leaderboard";
import { PickStore, pickFile } from "./picks";
import { scoreRound, type RoundScore } from "./score";

export interface Settled {
  /** Everybody who backed the round, and what it was worth. */
  scores: RoundScore[];
  /** False when this round was already on the board. */
  applied: boolean;
}

export function settleBacking(dataDir: string, network: string, roundId: string, winnerEntrantId: string): Settled {
  const picks = new PickStore(pickFile(dataDir, network), network).picksFor(roundId);
  const scores = scoreRound(picks, winnerEntrantId);
  if (scores.length === 0) return { scores, applied: false };
  const applied = new LeaderboardStore(leaderboardFile(dataDir, network), network).apply(roundId, scores);
  return { scores, applied };
}

/** The worker's call: scoring must never be what makes a round fail. */
export function settleBackingQuietly(dataDir: string, network: string, roundId: string, winnerEntrantId: string): void {
  try {
    const settled = settleBacking(dataDir, network, roundId, winnerEntrantId);
    if (settled.scores.length > 0) {
      log.info("backing settled", { roundId, backers: settled.scores.length, correct: settled.scores.filter((s) => s.correct).length, applied: settled.applied });
    }
  } catch (e) {
    // The round is over and its money is settled. A board that missed a round
    // is a board that missed a round.
    log.error("backing settle failed", { roundId, reason: e instanceof Error ? e.message : String(e) });
  }
}
