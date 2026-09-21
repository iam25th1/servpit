// The shapes a round is planned and settled in, and the id that ties the two
// together.
//
// Split out so the settle path can import what it needs without importing
// anything that decides. See test/settle-isolation.test.ts.

import { createHash } from "node:crypto";
import type { BankrollCache } from "../bankroll";
import type { AgentDecision, AgentSnapshot } from "../decisions/types";
import type { TransferLedger } from "../ledger";
import type { PlanStore } from "./planStore";
import type { PrizeSplit } from "./prize";
import type { RolloverStore } from "./rollover";
import type { ReconcileResult } from "../reconcile";
import type { CostMeter, ServClient } from "../serv/client";
import type { TransferOutcome } from "../transfers";
import type { Chain } from "../wallets/types";
import type { Wallets } from "../wallets/open";
import type { Entrant, RoundResult } from "@/engine/resolveRound";
import type { RoundStore } from "./store";

export interface FlowContext {
  /**
   * Plans already quoted. A settle reads one and is not allowed to make one,
   * so what the player saw is exactly what settles.
   */
  plans?: PlanStore;
  /**
   * What the pot carries between rounds. Required rather than optional: a
   * missing rollover store would silently drop every unclaimed prize, and
   * that is money.
   */
  rollover: RolloverStore;
  chain: Chain;
  wallets: Wallets;
  ledger: TransferLedger;
  store: RoundStore;
  bankroll: BankrollCache;
  meter: CostMeter;
  serv?: ServClient;
  entrants: number;
}

export interface EnteringAgent {
  agentId: string;
  entrantId: string;
  stakeWei: bigint;
  /** Borrowed from the bank to reach that stake. Absent when nothing was. */
  loanWei?: bigint;
  /** Interest per round on that loan, in basis points. */
  rateBps?: number;
}

/**
 * One loan the bank agreed to, as part of the plan the player was shown.
 *
 * Persisted like every other decision, so the settle path disburses what was
 * displayed and cannot work out its own answer.
 */
export interface PlannedLoan {
  agentId: string;
  name: string;
  address: string;
  principalWei: bigint;
  rateBps: number;
  reason: string;
  source: "serv" | "heuristic";
  rejection?: string;
  model?: string;
  latencyMs?: number;
}

export interface RoundPlan {
  roundId: string;
  seed: string;
  stakeWei: bigint;
  decisions: AgentDecision[];
  snapshots: AgentSnapshot[];
  entering: EnteringAgent[];
  bots: string[];
  entrants: Entrant[];
  servCalls: number;
  guardRefusals: number;
  rejections: Array<{ agentId: string; reason: string }>;
  /** Loans the bank agreed to this round. Empty when the bank is off. */
  loans: PlannedLoan[];
  /** Requests the bank turned down, for the panel and the log. */
  refusals: Array<{ agentId: string; name: string; reason: string }>;
}

export interface RoundRun {
  plan: RoundPlan;
  round: RoundResult;
  entries: TransferOutcome[];
  /** Loans the bank settled this round, before entries were collected. */
  loans: TransferOutcome[];
  payout: TransferOutcome | null;
  /**
   * Set when a house bot won. Eighteen of the twenty four entrants have no
   * wallet, so there is no payout to make and the prize stays in the pot.
   * Reported rather than only logged, because otherwise the result screen
   * shows entries that do not add up to the pot and nothing saying why.
   */
  retained: { winnerEntrantId: string; amountWei: bigint } | null;
  /** Where the round's pool went. The only money figure the settle believes. */
  prize: PrizeSplit;
  /** Rollover this round inherited, already counted inside prize.poolWei. */
  rolloverInWei: bigint;
  reconciliation: ReconcileResult;
}


/** Round id is derived from the seed and entrant count so a retry keys the same transfers. */
export function roundIdFor(seed: string, entrants: number): string {
  const digest = createHash("sha256").update(`servpit-round/${seed}/${entrants}`).digest("hex").slice(0, 16);
  return `r-${digest}`;
}
