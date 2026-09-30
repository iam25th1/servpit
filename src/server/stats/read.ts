// Opening the stores to read them, and only to read them.
//
// Every other path into these files goes through a store class that can write:
// RoundStore rewrites the history, TransferLedger records a transfer, the
// append only logs append. A report has no business holding any of that, so
// this file opens the files itself with readFileSync and parses them. Nothing
// here can create a file, take a lock or write a line, which is what
// test/stats-read-only.test.ts asserts by running the whole script against a
// directory it cannot write to.
//
// The names mirror the ones the contexts build in src/server/context.ts. They
// are written out rather than imported because importing a context would
// import the wallet stack, the ledger and the SERV client, and a report that
// can reach a wallet is one refactor away from using it.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The network the live pit plays on, and what the report defaults to. */
export const LIVE_NETWORK = "base-sepolia";

/** Where the stores are, unless an operator says otherwise. */
export function dataDirFrom(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.SERVPIT_DATA_DIR?.trim();
  return raw === undefined || raw.length === 0 ? "data" : raw;
}

export interface StorePaths {
  rounds: string;
  ledger: string;
  wrecks: string;
  debts: string;
  rollover: string;
  arena: string;
  plans: string;
  picks: string;
  pulls: string;
  fighters: string;
  careers: string;
  leaderboard: string;
}

export function storePaths(dataDir: string, network: string): StorePaths {
  return {
    rounds: join(dataDir, `rounds-${network}.json`),
    ledger: join(dataDir, `ledger-${network}.json`),
    wrecks: join(dataDir, `wrecks-${network}.json`),
    debts: join(dataDir, `debts-${network}.json`),
    rollover: join(dataDir, `rollover-${network}.json`),
    arena: join(dataDir, `arena-${network}.json`),
    plans: join(dataDir, `plans-${network}.json`),
    picks: join(dataDir, `picks-${network}.ndjson`),
    pulls: join(dataDir, `pulls-${network}.ndjson`),
    fighters: join(dataDir, `fighters-${network}.ndjson`),
    careers: join(dataDir, `careers-${network}.json`),
    leaderboard: join(dataDir, `leaderboard-${network}.json`),
  };
}

/**
 * What is on file, with anything missing left as null.
 *
 * Null rather than an empty object, so a store that is not there reads as not
 * recorded rather than as nothing having happened. The difference matters on
 * every line of the report.
 */
export interface Stores {
  network: string;
  dataDir: string;
  rounds: RoundRow[] | null;
  transfers: TransferRow[] | null;
  wrecks: WreckRow[] | null;
  debts: Record<string, DebtRow> | null;
  rollover: { rolloverWei?: string } | null;
  arena: ArenaFile | null;
  plans: PlanRow[] | null;
  picks: LogLine[] | null;
  pulls: LogLine[] | null;
  fighters: LogLine[] | null;
  careers: CareerRow[] | null;
  leaderboard: BoardRow[] | null;
}

/** Only the fields a stat reads. A store carrying more is not this file's business. */
export interface RoundRow {
  roundId: string;
  seed?: string;
  createdAt?: string;
  entrants?: number;
  winner?: string;
  potWei?: string;
  rakeWei?: string;
  servCalls?: number;
  servMicroCents?: number;
  reconciled?: boolean;
  /** Which checks ran and which failed. Absent on rounds stored before that was kept. */
  reconciliation?: { ran?: string[]; failed?: Array<{ name?: string; expected?: string; actual?: string }> };
  agents?: Array<{
    agentId?: string;
    entered?: boolean;
    stake?: number;
    source?: string;
    situation?: unknown;
    entryTxHash?: string;
    payoutTxHash?: string;
  }>;
}

export interface TransferRow {
  kind?: string;
  status?: string;
  amountWei?: string;
  feeWei?: string;
  txHash?: string;
  roundId?: string;
  agentId?: string;
  createdAt?: string;
}

export interface WreckRow {
  walletId?: string;
  identityId?: string;
  name?: string;
  trigger?: string;
  roundsSurvived?: number;
  wins?: number;
  peakBalanceWei?: string;
  debtAtDeathWei?: string;
  writtenOffWei?: string;
  seizedWei?: string;
  borrowedWei?: string;
  loanCount?: number;
  at?: string;
}

export interface DebtRow {
  principalWei?: string;
  interestWei?: string;
  rateBps?: number;
  borrowedWei?: string;
  repaidWei?: string;
  loanCount?: number;
}

export interface CareerRow {
  handle?: string;
  name?: string;
  rounds?: number;
  wins?: number;
  best?: number;
  kills?: number;
  longest?: number;
}

export interface BoardRow {
  handle?: string;
  points?: number;
  picks?: number;
  correct?: number;
  best?: number;
  reads?: number;
  readsRight?: number;
  perfect?: number;
}

export interface PlanRow {
  plan?: { decisions?: Array<{ source?: string; latencyMs?: number; model?: string; rejection?: string | null }> };
}

export interface ArenaFile {
  round?: ArenaRoundLike | null;
  last?: ArenaRoundLike | null;
  updatedAt?: string;
}

export interface ArenaRoundLike {
  roundId?: string;
  weiPerChip?: string;
  entrants?: number;
  fight?: {
    durationMs?: number;
    placements?: string[];
    log?: Array<{ type?: string; actor?: string; target?: string | null }>;
    /** What the reels drew for each seat in that one round. */
    characters?: Array<{ entrantId?: string; characterId?: string; tier?: string; combo?: string }>;
  };
}

/** One line per record, with a line cut in half by a crash skipped. */
export type LogLine = Record<string, unknown> & { k?: string };

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    // A store that will not parse is a store that cannot be counted. It reads
    // as absent rather than as empty, which is the whole point of null here.
    return null;
  }
}

function readLog(path: string): LogLine[] | null {
  if (!existsSync(path)) return null;
  const lines: LogLine[] = [];
  for (const text of readFileSync(path, "utf8").split("\n")) {
    if (text.length === 0) continue;
    try {
      lines.push(JSON.parse(text) as LogLine);
    } catch {
      // Torn by a crash mid append. Every whole line around it still counts.
    }
  }
  return lines;
}

const rowsOf = <T,>(body: unknown, key: string): T[] | null => {
  const value = (body as Record<string, unknown> | null)?.[key];
  return Array.isArray(value) ? (value as T[]) : null;
};

const mapOf = <T,>(body: unknown, key: string): Record<string, T> | null => {
  const value = (body as Record<string, unknown> | null)?.[key];
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, T>) : null;
};

/** Every store, read once. */
export function loadStores(dataDir: string, network: string): Stores {
  const paths = storePaths(dataDir, network);
  const ledger = mapOf<TransferRow>(readJson(paths.ledger), "transfers");
  return {
    network,
    dataDir,
    rounds: rowsOf<RoundRow>(readJson(paths.rounds), "rounds"),
    transfers: ledger === null ? null : Object.values(ledger),
    wrecks: rowsOf<WreckRow>(readJson(paths.wrecks), "wrecks"),
    debts: mapOf<DebtRow>(readJson(paths.debts), "debts"),
    rollover: readJson(paths.rollover) as { rolloverWei?: string } | null,
    arena: readJson(paths.arena) as ArenaFile | null,
    plans: rowsOf<PlanRow>(readJson(paths.plans), "plans"),
    picks: readLog(paths.picks),
    pulls: readLog(paths.pulls),
    fighters: readLog(paths.fighters),
    careers: rowsOf<CareerRow>(readJson(paths.careers), "rows"),
    leaderboard: rowsOf<BoardRow>(readJson(paths.leaderboard), "rows"),
  };
}
