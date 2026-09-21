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
}

export interface RoundRun {
  plan: RoundPlan;
  round: RoundResult;
  entries: TransferOutcome[];
  payout: TransferOutcome | null;
  /**
   * Set when a house bot won. Eighteen of the twenty four entrants have no
   * wallet, so there is no payout to make and the prize stays in the pot.
   * Reported rather than only logged, because otherwise the result screen
   * shows entries that do not add up to the pot and nothing saying why.
   */
  retained: { winnerEntrantId: string; amountWei: bigint } | null;
  reconciliation: ReconcileResult;
}


/** Round id is derived from the seed and entrant count so a retry keys the same transfers. */
export function roundIdFor(seed: string, entrants: number): string {
  const digest = createHash("sha256").update(`servpit-round/${seed}/${entrants}`).digest("hex").slice(0, 16);
  return `r-${digest}`;
}
