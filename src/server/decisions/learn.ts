// What the pit does when it is not reasoning: what it did last time it was.
//
// Reasoning costs money per round, so most rounds run without it. The
// fallback used to be a fixed rule with a coin flip in it, which is honest
// and says nothing about this pit. This is the other option: in a spot like
// this one, what did SERV actually decide for this agent?
//
// Three rules keep it honest.
//
// It imitates decisions, never outcomes. Only what SERV chose is read: what
// happened afterwards is not looked at and could not be used if it were. One
// fight in twenty four is variance at every sample size this pit will ever
// have, so learning from results would be learning from noise and calling it
// judgement.
//
// It only speaks when it has seen enough. Below MIN_MATCHES rounds in the
// same band, it says nothing and the fixed rule answers, which is exactly
// what a pit with no history does.
//
// It is deterministic. The same spot against the same record gives the same
// answer, every time, with no clock and no randomness in it.
//
// Arithmetic only. Nothing here reaches a model, a wallet or a network.

import type { StoredRound } from "../round/store";
import { bandOf, type Situation } from "./situation";
import type { Decision } from "./types";

/**
 * How many past reasoned rounds in the same band it takes to speak.
 *
 * Five. Below that a single unusual round is a majority, and the pit would
 * be repeating one decision rather than a pattern. Five is also the smallest
 * number where a split is possible either way, which is what makes "held
 * more often than it entered" mean anything at all.
 */
export const MIN_MATCHES = 5;

/** What a learned decision was drawn from, for the panel that shows it. */
export interface LearnedEvidence {
  /** Reasoned rounds in this band, for this agent. */
  matches: number;
  /** How many of them SERV entered. */
  entered: number;
  /** The stake it usually put up when it did, in chips. */
  typicalStake: number;
  /** The band itself, so a reader can see what counted as similar. */
  band: string;
}

export interface LearnedDecision {
  decision: Decision;
  evidence: LearnedEvidence;
}

/** The middle value, which is what a typical stake means here. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  // Even counts take the lower of the two, so the answer is always a stake
  // that was actually put up rather than an average nobody chose.
  return sorted.length % 2 === 1 ? sorted[middle]! : sorted[middle - 1]!;
}

/**
 * What this agent's reasoned rounds say about a spot like this one.
 *
 * Null when the record does not hold enough of them, which is the caller's
 * signal to use the fixed rule.
 */
export function learnedDecision(
  agentId: string,
  situation: Situation,
  stakeChips: number,
  rounds: readonly StoredRound[],
  minMatches: number = MIN_MATCHES,
): LearnedDecision | null {
  const band = bandOf(situation, stakeChips);
  const matches: Array<{ entered: boolean; stake: number }> = [];
  for (const round of rounds) {
    for (const agent of round.agents) {
      if (agent.agentId !== agentId) continue;
      // Reasoned rounds only. A learned decision drawn from learned decisions
      // would be the pit teaching itself its own echo.
      if (agent.source !== "serv" || !agent.situation) continue;
      if (bandOf(agent.situation, stakeChips) !== band) continue;
      matches.push({ entered: agent.entered, stake: agent.stake });
    }
  }

  if (matches.length < minMatches) return null;

  const entered = matches.filter((m) => m.entered);
  // A tie holds. Entering spends a seat and can wreck an agent; holding
  // spends nothing, so the fifty fifty case takes the cheaper mistake.
  const enter = entered.length > matches.length / 2;
  const typicalStake = median(entered.map((m) => m.stake));
  const evidence: LearnedEvidence = { matches: matches.length, entered: entered.length, typicalStake, band };

  if (!enter) {
    return {
      decision: {
        enter: false,
        stake: 0,
        reason: `learned: in ${matches.length} reasoned rounds like this one it entered ${entered.length}, so it sits this out`,
      },
      evidence,
    };
  }

  return {
    decision: {
      enter: true,
      // The stake it usually put up, never more than this round's ceiling is
      // decided elsewhere: this number goes through the same validator every
      // other answer does, against the balance read from the chain.
      stake: Math.max(stakeChips, typicalStake),
      reason: `learned: in ${matches.length} reasoned rounds like this one it entered ${entered.length}, usually for ${Math.max(stakeChips, typicalStake)} chips`,
    },
    evidence,
  };
}
