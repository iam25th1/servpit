// One line per round, kept for good.
//
// The round store keeps the last two hundred rounds in full, which is what a
// decision needs to read and about ten hours of the live pit. Everything older
// used to be gone, so the reasoned rounds of nine days ago could not be
// counted, and nothing in the project could say how many rounds it had ever
// played.
//
// This is the cheap permanent half: an append only log with one short line per
// round, never trimmed. The full record can keep rolling. A line carries what
// a report wants and nothing a decision needs, and every field that cannot be
// known is null rather than a guess.
//
// Same shape as the other append only logs here: network namespaced by its
// name and by a head line inside it, appended under the lock because O_APPEND
// does not promise a whole line, and a line torn by a crash is skipped.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withAppendLock } from "../backing/appendLock";
import { StoreNetworkMismatch, storeStamp } from "../store/file";

/** Which kind of answer the round's agents gave, when it can be known. */
export type RoundClass = "reasoned" | "learned" | "instinct";

/** What is worth keeping about a round for good. Null means not known. */
export interface RoundSummary {
  roundId: string;
  /** When it was played. Null on a backfilled round nothing could date. */
  at: string | null;
  entrants: number | null;
  winner: string | null;
  potWei: string | null;
  /** Reasoned, learned or instinct. Null when no store can say. */
  answers: RoundClass | null;
  servCalls: number | null;
  /** This round's own spend, never a meter total. */
  servMicroCents: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  reconciled: boolean | null;
  /** True when the row was reconstructed from other stores after the fact. */
  backfilled?: true;
}

type Line = ({ k: "round" } & RoundSummary) | { k: "head"; network: string };

/**
 * Which kind of answer a round's decisions add up to.
 *
 * The same rule the report uses: reasoned if any decision came from the model,
 * learned if none did and any was drawn from what it learned before, instinct
 * if every one was the fixed rule, and null when there are no sources to read
 * at all. Null is never instinct: a round nobody can speak for is a round
 * nobody can speak for.
 */
export function classOfSources(sources: readonly (string | undefined)[]): RoundClass | null {
  if (sources.length === 0) return null;
  if (sources.includes("serv")) return "reasoned";
  if (sources.includes("learned")) return "learned";
  if (sources.every((s) => s === undefined)) return null;
  return "instinct";
}

export function summaryFile(dataDir: string, network: string): string {
  return join(dataDir, `summaries-${network}.ndjson`);
}

export class SummaryStore {
  private stamp: string | null = null;
  private rows = new Map<string, RoundSummary>();

  constructor(
    private readonly file: string,
    private readonly network: string,
  ) {}

  /** Whether this round already has a line. */
  has(roundId: string): boolean {
    this.reload();
    return this.rows.has(roundId);
  }

  /** Every round, oldest first where a date is known, undated rows last. */
  all(): RoundSummary[] {
    this.reload();
    return [...this.rows.values()].sort((a, b) => {
      if (a.at === null) return b.at === null ? a.roundId.localeCompare(b.roundId) : 1;
      if (b.at === null) return -1;
      return Date.parse(a.at) - Date.parse(b.at) || a.roundId.localeCompare(b.roundId);
    });
  }

  /**
   * Appends a round, or does nothing when it already has a line written by the
   * settle. A backfilled line never overwrites one the settle wrote, and the
   * settle's line replaces a backfilled one, because the settle was there.
   */
  append(summary: RoundSummary): boolean {
    this.head();
    return withAppendLock(this.file, () => {
      this.stamp = null;
      this.reload();
      const held = this.rows.get(summary.roundId);
      if (held !== undefined && (held.backfilled === undefined || summary.backfilled === true)) return false;
      const line: Line = { k: "round", ...summary };
      appendFileSync(this.file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
      this.stamp = null;
      return true;
    });
  }

  private head(): void {
    if (existsSync(this.file)) return;
    mkdirSync(dirname(this.file), { recursive: true });
    try {
      writeFileSync(this.file, `${JSON.stringify({ k: "head", network: this.network })}\n`, { flag: "wx", mode: 0o600 });
    } catch {
      // Another writer created it first, which is the same file either way.
    }
  }

  private reload(): void {
    const stamp = storeStamp(this.file);
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    this.rows = new Map();
    if (stamp === "") return;

    for (const text of readFileSync(this.file, "utf8").split("\n")) {
      if (text.length === 0) continue;
      let line: Line;
      try {
        line = JSON.parse(text) as Line;
      } catch {
        // Torn by a crash mid append. Every whole line around it stands.
        continue;
      }
      if (line.k === "head") {
        if (line.network !== this.network) throw new StoreNetworkMismatch(this.file, line.network, this.network);
        continue;
      }
      if (line.k !== "round" || typeof line.roundId !== "string") continue;
      // The kind is the line's tag on disk and not part of the record.
      const summary: RoundSummary = {
        roundId: line.roundId,
        at: line.at ?? null,
        entrants: line.entrants ?? null,
        winner: line.winner ?? null,
        potWei: line.potWei ?? null,
        answers: line.answers ?? null,
        servCalls: line.servCalls ?? null,
        servMicroCents: line.servMicroCents ?? null,
        tokensIn: line.tokensIn ?? null,
        tokensOut: line.tokensOut ?? null,
        reconciled: line.reconciled ?? null,
        ...(line.backfilled === true ? { backfilled: true as const } : {}),
      };
      const held = this.rows.get(summary.roundId);
      // A line the settle wrote wins over a backfilled one whichever order
      // they landed in, and otherwise the later line stands.
      if (held !== undefined && held.backfilled === undefined && summary.backfilled === true) continue;
      this.rows.set(summary.roundId, summary);
    }
  }
}
