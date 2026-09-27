// Who has called the most rounds right.
//
// Points, picks, correct picks, the current streak and how well each handle
// reads the agents, per handle. Nothing here is money, redeemable or
// transferable, and a handle is unverified: one person can hold several,
// which the README says out loud.
//
// One writer, the worker, settling a round once it is over, so this is an
// ordinary store rather than the append only log the picks themselves need.
// Settling is recorded by round id and refuses to apply the same round twice,
// because a worker that crashes between the result and the settle will run
// the settle again when it comes back.

import { StoreFile, UNKNOWN_NETWORK } from "../store/file";
import type { RoundScore } from "./score";
import { join } from "node:path";

export interface BoardRow {
  handle: string;
  /** Everything this handle has scored, from backing and from reading the agents. */
  points: number;
  /** Rounds backed, and how many of them were called right. */
  picks: number;
  correct: number;
  /** Correct calls in a row, as of the last round this handle backed. */
  streak: number;
  /** The longest that streak has ever been. */
  best: number;
  /** Agents called in or out, across every round this handle read. */
  reads: number;
  /** How many of those calls were right. */
  readsRight: number;
  /** Rounds where every agent was called and every call was right. */
  perfect: number;
}

/** One visitor's read of one round, as the settle scores it. */
export interface ReadScoreRow {
  handle: string;
  called: number;
  right: number;
  perfect: boolean;
  points: number;
}

/** The key a round's reads are settled under, apart from its backing. */
const readsKey = (roundId: string): string => `reads:${roundId}`;

/** A row with nothing in it yet. */
const emptyRow = (handle: string): BoardRow => ({ handle, points: 0, picks: 0, correct: 0, streak: 0, best: 0, reads: 0, readsRight: 0, perfect: 0 });

export function leaderboardFile(dataDir: string, network: string): string {
  return join(dataDir, `leaderboard-${network}.json`);
}

/** A page of the board, with enough to draw the pager. */
export interface BoardPage {
  rows: BoardRow[];
  page: number;
  pages: number;
  total: number;
}

const isRow = (value: unknown): value is BoardRow => {
  const row = value as Partial<BoardRow> | null;
  return typeof row?.handle === "string" && typeof row.points === "number" && typeof row.picks === "number";
};

export class LeaderboardStore {
  private rowsByHandle = new Map<string, BoardRow>();
  private settled: string[] = [];
  private readonly sync: StoreFile;

  constructor(file: string, network: string = UNKNOWN_NETWORK) {
    this.sync = new StoreFile(file, network, (body) => this.load(body));
    this.sync.read();
  }

  private load(body: Record<string, unknown> | null): void {
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    // Rows written before reads existed carry none of those fields, and read
    // as a handle that has never called an agent.
    this.rowsByHandle = new Map(
      rows.filter(isRow).map((row) => [row.handle, { ...emptyRow(row.handle), ...row, streak: row.streak ?? 0, best: row.best ?? 0, reads: row.reads ?? 0, readsRight: row.readsRight ?? 0, perfect: row.perfect ?? 0 }]),
    );
    const settled = Array.isArray(body?.settled) ? body.settled : [];
    this.settled = settled.filter((id): id is string => typeof id === "string");
  }

  /** Whether this round has already been scored onto the board. */
  has(roundId: string): boolean {
    this.sync.read();
    return this.settled.includes(roundId);
  }

  /**
   * Adds a round's scores, once.
   *
   * A repeated round is ignored rather than refused: the settle that runs
   * again after a restart is doing the right thing, and the board has
   * already got it.
   */
  apply(roundId: string, scores: readonly RoundScore[]): boolean {
    this.sync.read();
    if (this.settled.includes(roundId)) return false;
    for (const score of scores) {
      const row = this.rowsByHandle.get(score.handle) ?? emptyRow(score.handle);
      row.points += score.points;
      row.picks += 1;
      if (score.correct) {
        row.correct += 1;
        row.streak += 1;
        row.best = Math.max(row.best, row.streak);
      } else {
        // A wrong call ends a run. Backing nothing at all does not, because a
        // handle that sat a round out is not on its scores.
        row.streak = 0;
      }
      this.rowsByHandle.set(score.handle, row);
    }
    this.settled.push(roundId);
    // Only what a board is asked about: the last few hundred rounds is plenty
    // to keep a settle idempotent without the file growing without end.
    if (this.settled.length > 1000) this.settled = this.settled.slice(-1000);
    this.write();
    return true;
  }

  /**
   * Adds a round's reads, once.
   *
   * Settled under a key of its own, so a round's backing and its reads are
   * each applied exactly once however the two settles are ordered or repeated.
   * A read never touches the backing streak: calling agents and calling a
   * winner are two different judgements, and one must not end a run of the
   * other.
   */
  applyReads(roundId: string, scores: readonly ReadScoreRow[]): boolean {
    this.sync.read();
    const key = readsKey(roundId);
    if (this.settled.includes(key)) return false;
    for (const score of scores) {
      const row = this.rowsByHandle.get(score.handle) ?? emptyRow(score.handle);
      row.points += score.points;
      row.reads += score.called;
      row.readsRight += score.right;
      if (score.perfect) row.perfect += 1;
      this.rowsByHandle.set(score.handle, row);
    }
    this.settled.push(key);
    if (this.settled.length > 1000) this.settled = this.settled.slice(-1000);
    this.write();
    return true;
  }

  /** Whether this round's reads have already been scored onto the board. */
  hasReads(roundId: string): boolean {
    this.sync.read();
    return this.settled.includes(readsKey(roundId));
  }

  /** Every row, best first, then by handle so the order never wobbles. */
  rows(): BoardRow[] {
    this.sync.read();
    return [...this.rowsByHandle.values()].sort((a, b) => b.points - a.points || b.readsRight - a.readsRight || b.correct - a.correct || a.handle.localeCompare(b.handle));
  }

  /** One page of it, counted from one. */
  page(page: number, size: number): BoardPage {
    const all = this.rows();
    const pages = Math.max(1, Math.ceil(all.length / size));
    const at = Math.min(Math.max(1, Math.floor(page)), pages);
    return { rows: all.slice((at - 1) * size, at * size), page: at, pages, total: all.length };
  }

  /** One handle's row, for the viewer's own line on the result screen. */
  row(handle: string): BoardRow | null {
    this.sync.read();
    return this.rowsByHandle.get(handle) ?? null;
  }

  private write(): void {
    this.sync.write({ rows: [...this.rowsByHandle.values()], settled: this.settled });
  }
}
