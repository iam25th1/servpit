// A fighter's record, across every round it has been in.
//
// One writer, the settle path, once a round is over, so this is an ordinary
// store rather than the append only log the claims themselves need. Rounds
// are recorded by id and applied once: a worker that crashes between the
// result and the settle runs the settle again when it comes back, and the
// record must not count that round twice.
//
// The record is kept by handle rather than by claim, so a seat released and
// claimed again by the same handle carries on the same career.

import { join } from "node:path";
import { StoreFile, UNKNOWN_NETWORK } from "../store/file";
import type { FighterRound } from "./career";

export interface CareerRow {
  handle: string;
  /** The name it last fought under, for a board that reads like the pit. */
  name: string;
  face: string;
  rounds: number;
  wins: number;
  /** The best it has ever placed. Zero until it has been in a round. */
  best: number;
  kills: number;
  /** Rounds in the top half in a row, as of its last round. */
  streak: number;
  /** The longest that run has ever been. */
  longest: number;
}

export interface CareerPage {
  rows: CareerRow[];
  page: number;
  pages: number;
  total: number;
}

export function careerFile(dataDir: string, network: string): string {
  return join(dataDir, `careers-${network}.json`);
}

const isRow = (value: unknown): value is CareerRow => {
  const row = value as Partial<CareerRow> | null;
  return typeof row?.handle === "string" && typeof row.rounds === "number";
};

export class CareerStore {
  private rowsByHandle = new Map<string, CareerRow>();
  private settled: string[] = [];
  private readonly sync: StoreFile;

  constructor(file: string, network: string = UNKNOWN_NETWORK) {
    this.sync = new StoreFile(file, network, (body) => this.load(body));
    this.sync.read();
  }

  private load(body: Record<string, unknown> | null): void {
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    this.rowsByHandle = new Map(rows.filter(isRow).map((row) => [row.handle, { ...row }]));
    const settled = Array.isArray(body?.settled) ? body.settled : [];
    this.settled = settled.filter((id): id is string => typeof id === "string");
  }

  /** Whether this round has already been counted. */
  has(roundId: string): boolean {
    this.sync.read();
    return this.settled.includes(roundId);
  }

  /**
   * Adds a round's fighters, once.
   *
   * A repeated round is ignored rather than refused, for the same reason the
   * board ignores one: the settle that runs again after a restart is doing
   * the right thing and the record already has it.
   */
  apply(roundId: string, rows: readonly FighterRound[], named: ReadonlyMap<string, { name: string; face: string }>): boolean {
    this.sync.read();
    if (this.settled.includes(roundId)) return false;
    for (const round of rows) {
      const who = named.get(round.handle);
      const row = this.rowsByHandle.get(round.handle) ?? {
        handle: round.handle,
        name: who?.name ?? round.handle,
        face: who?.face ?? "",
        rounds: 0,
        wins: 0,
        best: 0,
        kills: 0,
        streak: 0,
        longest: 0,
      };
      if (who) {
        row.name = who.name;
        row.face = who.face;
      }
      row.rounds += 1;
      row.kills += round.kills;
      if (round.won) row.wins += 1;
      row.best = row.best === 0 ? round.placement : Math.min(row.best, round.placement);
      if (round.outlasted) {
        row.streak += 1;
        row.longest = Math.max(row.longest, row.streak);
      } else {
        row.streak = 0;
      }
      this.rowsByHandle.set(round.handle, row);
    }
    this.settled.push(roundId);
    if (this.settled.length > 500) this.settled = this.settled.slice(-500);
    this.write();
    return true;
  }

  /**
   * Every row, best first.
   *
   * Wins, then best placement, then kills, then rounds, and the handle last
   * so the order never wobbles between two identical records.
   */
  rows(): CareerRow[] {
    this.sync.read();
    return [...this.rowsByHandle.values()].sort(
      (a, b) => b.wins - a.wins || (a.best === 0 ? 99 : a.best) - (b.best === 0 ? 99 : b.best) || b.kills - a.kills || b.rounds - a.rounds || a.handle.localeCompare(b.handle),
    );
  }

  /** One page of it, counted from one. */
  page(page: number, size: number): CareerPage {
    const all = this.rows();
    const pages = Math.max(1, Math.ceil(all.length / size));
    const at = Math.min(Math.max(1, Math.floor(page)), pages);
    return { rows: all.slice((at - 1) * size, at * size), page: at, pages, total: all.length };
  }

  /** One handle's record, for the viewer's own line. */
  row(handle: string): CareerRow | null {
    this.sync.read();
    return this.rowsByHandle.get(handle) ?? null;
  }

  private write(): void {
    this.sync.write({ rows: [...this.rowsByHandle.values()], settled: this.settled });
  }
}
