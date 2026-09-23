// Shapes shared by the decision loop and the round flow.

import type { AgentProfile } from "@/config/agents";
import type { LearnedEvidence } from "./learn";
import type { Situation } from "./situation";

export interface RoundOutcome {
  roundId: string;
  entered: boolean;
  /** Payout minus entry for that round, in wei. Negative when the entry was lost. */
  netWei: bigint;
}

export interface AgentSnapshot {
  profile: AgentProfile;
  address: string;
  /** Balance read from chain for this round. */
  balanceWei: bigint;
  /** Stake this round asks for, in wei. The floor when the bank is on. */
  stakeWei: bigint;
  /**
   * How many base stakes this agent may put on one seat.
   *
   * Absent or one means the fixed stake the game has always used. Above one
   * only when the bank is enabled, because anything above the balance has to
   * be borrowed from somewhere.
   */
  maxStakeMultiple?: number;
  /** What this agent already owes the lender, in wei. Absent when nothing. */
  debtWei?: bigint;
  recentOutcomes: RoundOutcome[];
}

export interface RoundContext {
  roundId: string;
  participants: number;
  poolWei: bigint;
  stakeWei: bigint;
}

export interface Decision {
  enter: boolean;
  /** Integer minor units. Zero when not entering. */
  stake: number;
  reason: string;
}

/**
 * Where an answer came from, and never a flattering guess.
 *
 * serv       a model answered and the answer passed validation
 * learned    drawn from what serv decided for this agent in a spot like this
 * heuristic  the fixed rule, which is what a pit with no history does
 *
 * A learned decision is never labelled reasoned. It is the pit repeating a
 * pattern it was shown, which is a different claim from the pit thinking.
 */
export type DecisionSource = "serv" | "learned" | "heuristic";

export interface AgentDecision {
  agentId: string;
  name: string;
  strategy: string;
  address: string;
  /** The roster face for a replacement. Null for the originals. */
  face?: string | null;
  /** What this agent owes the lender, in wei. Absent when the bank is off. */
  debtWei?: bigint;
  balanceWei: bigint;
  decision: Decision;
  source: DecisionSource;
  /** The spot it was in, recorded so a later round can learn from this one. */
  situation?: Situation;
  /** What a learned answer was drawn from. Only on a learned one. */
  evidence?: LearnedEvidence;
  /** Why the SERV answer was not used, when it was not. */
  rejection?: string;
  model?: string;
  latencyMs?: number;
}
