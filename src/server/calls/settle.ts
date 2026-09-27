// Scoring a finished round's reads onto the board.
//
// Read the calls filed before the round started, score each against what the
// round decided, add them to the board once. Nothing here can move money or
// reach an agent: the inputs are a log of calls and the round's own final
// decisions, and the output is a file of numbers.
//
// Called by the worker after the result is published, like the backing settle,
// so the read a viewer is told about and the points they earned come from the
// same finished round.

import { readOutcome, scoreRead, type DecisionLike } from "@/config/reads";
import { log } from "../log";
import { LeaderboardStore, leaderboardFile, type ReadScoreRow } from "../backing/leaderboard";
import { PickStore, pickFile } from "../backing/picks";
import { CALL_SEATS } from "./service";

export interface ReadsSettled {
  scores: ReadScoreRow[];
  /** False when this round's reads were already on the board, or nobody called it. */
  applied: boolean;
}

export interface ReadsRound {
  /** The round the calls were filed after. */
  after: string;
  /** The round being scored, which is the key the board settles it under. */
  roundId: string;
  /** When it started. Calls made after this moment are never counted. */
  startedAt: number;
  /** Its final decisions, after the chain's own check. */
  decisions: readonly DecisionLike[];
}

export function settleReads(dataDir: string, network: string, round: ReadsRound): ReadsSettled {
  const calls = new PickStore(pickFile(dataDir, network), network).callsAfter(round.after, round.startedAt);
  const outcome = readOutcome(round.decisions, CALL_SEATS);
  const scores: ReadScoreRow[] = [...calls].map(([handle, made]) => {
    const result = scoreRead(made, outcome);
    return { handle, called: result.called, right: result.right, perfect: result.perfect, points: result.points };
  });
  if (scores.length === 0) return { scores, applied: false };
  const applied = new LeaderboardStore(leaderboardFile(dataDir, network), network).applyReads(round.roundId, scores);
  return { scores, applied };
}

/** The worker's call: scoring must never be what makes a round fail. */
export function settleReadsQuietly(dataDir: string, network: string, round: ReadsRound): void {
  try {
    const settled = settleReads(dataDir, network, round);
    if (settled.scores.length > 0) {
      log.info("reads settled", { roundId: round.roundId, readers: settled.scores.length, perfect: settled.scores.filter((s) => s.perfect).length, applied: settled.applied });
    }
  } catch (e) {
    // The round is over and its money is settled. A board that missed a round
    // is a board that missed a round.
    log.error("reads settle failed", { roundId: round.roundId, reason: e instanceof Error ? e.message : String(e) });
  }
}
