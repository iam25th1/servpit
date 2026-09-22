// Watching the last round again.
//
// An interval is long, and for most of it the pit is resting. A visitor who
// arrives then should be able to see what the pit actually does rather than
// read a countdown, so the resting screen can play the last finished round
// back: the decisions, the lender, the draw, the fight and the figures.
//
// Nothing here fetches anything. A replay is built from the round the feed
// already carries, which was recorded when that round settled, so it costs no
// SERV call and no chain call and it cannot be affected by either.
//
// The one rule that matters: only a finished round can be replayed. The live
// round has no outcome in any response before its fight starts, and this
// never reads the live round at all, so a replay cannot be a way to see a
// result early.

import type { ArenaPhase } from "@/server/arena/state";
import type { ArenaFeedRound, ArenaFeedView } from "./arenaScreens";

/**
 * How long each part of a replay runs.
 *
 * The recorded marks are wall time from the round itself, where deciding can
 * be half a minute of six agents waiting on a model. That is the pit's pace,
 * not a replay's: these are the designed lengths, and only the fight keeps
 * its own, because the fight is the one part with a clock of its own.
 */
export const REPLAY_LINEUP_MS = 7_000;
export const REPLAY_BUYIN_MS = 4_000;
export const REPLAY_REELS_MS = 6_000;
export const REPLAY_RESULT_MS = 10_000;

/** The phases a replay walks, in order, with how long each one holds. */
const STEPS: Array<{ phase: ArenaPhase; ms: number | "fight" }> = [
  { phase: "deciding", ms: REPLAY_LINEUP_MS },
  { phase: "settling", ms: REPLAY_BUYIN_MS },
  { phase: "reels", ms: REPLAY_REELS_MS },
  { phase: "fight", ms: "fight" },
  { phase: "result", ms: REPLAY_RESULT_MS },
];

/**
 * The round a visitor is allowed to replay, or null.
 *
 * Only the finished round the feed keeps in last, and only once it carries
 * both a fight to play and a result to land on. The live round is never a
 * candidate, whatever it happens to carry.
 */
export function replayableRound(view: ArenaFeedView | null): ArenaFeedRound | null {
  const last = view?.last;
  if (!last) return null;
  if (!last.fight || last.fight.log.length === 0) return null;
  if (!last.result) return null;
  return last;
}

/** How long a whole replay of this round takes. */
export function replayDurationMs(round: ArenaFeedRound): number {
  return STEPS.reduce((total, step) => total + (step.ms === "fight" ? (round.fight?.durationMs ?? 0) : step.ms), 0);
}

/**
 * The round as it looked at this point of the replay, or null once it is over.
 *
 * The phase mark is stamped with the moment that phase began in this replay
 * rather than when it happened for real, so everything downstream that reads
 * a mark, including where to start the fight, works on a replay exactly as it
 * works on a live round. There is one mark, because a replay is one pass.
 */
export function replayFrame(round: ArenaFeedRound, startedAt: number, now: number): ArenaFeedRound | null {
  const elapsed = now - startedAt;
  if (elapsed < 0) return null;
  let at = 0;
  for (const step of STEPS) {
    const ms = step.ms === "fight" ? (round.fight?.durationMs ?? 0) : step.ms;
    if (elapsed < at + ms) {
      return {
        ...round,
        phase: step.phase,
        phases: [{ phase: step.phase, at: new Date(startedAt + at).toISOString(), ...(step.phase === "fight" ? { durationMs: ms } : {}) }],
      };
    }
    at += ms;
  }
  return null;
}
