// Shapes shared by the decision loop and the round flow.

import type { AgentProfile } from "@/config/agents";

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
  /** Stake this round asks for, in wei. */
  stakeWei: bigint;
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

export type DecisionSource = "serv" | "heuristic";

export interface AgentDecision {
  agentId: string;
  name: string;
  strategy: string;
  address: string;
  balanceWei: bigint;
  decision: Decision;
  source: DecisionSource;
  /** Why the SERV answer was not used, when it was not. */
  rejection?: string;
  model?: string;
  latencyMs?: number;
}
