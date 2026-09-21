// What the pit is doing right now, and what it last did.
//
// Written by the worker and by nobody else. The read only endpoint projects
// from this, and the projection is where the spoiler rule lives: the resolver
// is deterministic, so a seed is a winner, and a log is a winner, and neither
// belongs in a response before the fight starts.
//
// The outcome is not written here at all until the fight phase begins. That
// is a second net under the projection: a bug in a route cannot leak what the
// store does not hold yet.

import { join } from "node:path";
import { StoreFile, UNKNOWN_NETWORK } from "../store/file";

/**
 * Where a round is.
 *
 * planning  the round id exists and the plan is being built
 * deciding  the agents are answering
 * banking   the lender is answering, one request at a time
 * settling  entries are moving on chain
 * fight     the pit is playing out, for a known duration
 * result    settled, and the figures are final
 * resting   nothing is running, and the reason says why
 * failed    the round did not finish, and the reason says why
 */
export type ArenaPhase = "planning" | "deciding" | "banking" | "settling" | "fight" | "result" | "resting" | "failed";

export interface PhaseMark {
  phase: ArenaPhase;
  at: string;
  /** Only on fight: how long the playback runs, so every viewer sees one moment. */
  durationMs?: number;
  /** Only on resting and failed: a sentence a player can read. */
  reason?: string;
}

/** A decision as the arena publishes it. Chips, and where the answer came from. */
export interface ArenaDecision {
  agentId: string;
  name: string;
  face: string | null;
  enter: boolean;
  stake: number;
  reason: string;
  /** serv or heuristic: whether a model answered or the fallback did. */
  source: string;
  balance: number;
  debt: number;
}

export interface ArenaLoan {
  agentId: string;
  name: string;
  asked: number;
  amount: number;
  rateBps: number;
  reason: string;
  source: string;
}

export interface ArenaRefusal {
  agentId: string;
  name: string;
  asked: number;
  reason: string;
  source: string;
}

/**
 * The fight, and everything that gives it away.
 *
 * Written when the fight phase starts and never before it. The seed is here
 * rather than on the round, because the resolver is deterministic and a seed
 * handed out during the decisions is the winner handed out during the
 * decisions.
 */
export interface ArenaFight {
  seed: string;
  durationMs: number;
  characters: unknown[];
  log: unknown[];
  placements: string[];
  names: Record<string, string>;
}

export interface ArenaResult {
  winner: string;
  potWei: string;
  rakeWei: string;
  payoutWei: string;
  rolloverInWei: string;
  nextRolloverWei: string;
  reconciled: boolean;
  transfers: Array<{ kind: string; agentId: string; amountWei: string; txHash: string | null; link: string | null }>;
  repayment: { agentId: string; name: string; interestWei: string; principalWei: string; paidWei: string; link: string | null } | null;
  wrecks: unknown[];
  replacements: unknown[];
  interest: Array<{ agentId: string; chargedWei: string; rateBps: number }>;
  servCalls: number;
  costSummary: string;
}

export interface ArenaRound {
  roundId: string;
  startedAt: string;
  phase: ArenaPhase;
  phases: PhaseMark[];
  network: string;
  backend: string;
  entrants: number;
  bots: number;
  stakeChips: number;
  weiPerChip: string;
  decisions: ArenaDecision[];
  loans: ArenaLoan[];
  refusals: ArenaRefusal[];
  bank: { treasury: number; book: Array<{ agentId: string; name: string; owed: number; principal: number; rateBps: number }> } | null;
  entries: Array<{ agentId: string; amountWei: string; txHash: string | null; link: string | null }>;
  /** Absent until the fight phase begins. */
  fight?: ArenaFight;
  /** Absent until the round is settled. */
  result?: ArenaResult;
}

export interface ArenaState {
  /** The round being played, or the last one if the pit is resting. */
  round: ArenaRound | null;
  /** The last round that finished, kept whole. */
  last: ArenaRound | null;
  /** Set by the worker from the pause file, so a reader can see why it is idle. */
  paused: boolean;
  /** When the next round is due, so a client can show a countdown. */
  nextRoundAt: string | null;
  updatedAt: string;
}

const EMPTY: ArenaState = { round: null, last: null, paused: false, nextRoundAt: null, updatedAt: new Date(0).toISOString() };

export class ArenaStore {
  private state: ArenaState = { ...EMPTY };
  private readonly sync: StoreFile;

  constructor(file: string, network: string = UNKNOWN_NETWORK) {
    this.sync = new StoreFile(file, network, (body) => {
      const round = (body?.round ?? null) as ArenaRound | null;
      const last = (body?.last ?? null) as ArenaRound | null;
      this.state = {
        round,
        last,
        paused: body?.paused === true,
        nextRoundAt: typeof body?.nextRoundAt === "string" ? body.nextRoundAt : null,
        updatedAt: typeof body?.updatedAt === "string" ? body.updatedAt : EMPTY.updatedAt,
      };
    });
    this.sync.read();
  }

  /** Whatever is on file now. The reader is a different process from the writer. */
  read(): ArenaState {
    this.sync.read();
    return this.state;
  }

  write(next: Omit<ArenaState, "updatedAt">): ArenaState {
    this.state = { ...next, updatedAt: new Date().toISOString() };
    this.sync.write(this.state as unknown as Record<string, unknown>);
    return this.state;
  }
}

/** The one path, so the worker and the route never disagree about it. */
export function arenaFile(dataDir: string, network: string): string {
  return join(dataDir, `arena-${network}.json`);
}
