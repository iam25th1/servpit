// What ended an agent, not only what it was recorded as.
//
// The 12c simulation found that most agents that over-reach are recorded as
// broke and denied rather than over the ceiling: they lose their balance
// before their debt compounds past it. Both are the same story, told from
// different ends, and a screen that says only "denied credit" tells the wrong
// half of it.
//
// So the trigger is recorded alongside what led there: how hard it had been
// pushing, whether it was playing with borrowed chips, how far it had fallen
// from its best, and how long it lasted.

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The condition the rules module fired on. */
export type WreckTrigger = "debt above the ceiling" | "broke and denied credit";

export interface WreckRecord {
  roundId: string;
  walletId: string;
  identityId: string;
  name: string;
  trigger: WreckTrigger;
  /** Wei throughout. Chips are for the screen. */
  balanceAtDeathWei: string;
  debtAtDeathWei: string;
  principalAtDeathWei: string;
  interestAtDeathWei: string;
  seizedWei: string;
  writtenOffWei: string;
  /** The most it ever held, so a fall is visible as a fall. */
  peakBalanceWei: string;
  /** Total it ever borrowed, and how many advances that took. */
  borrowedWei: string;
  loanCount: number;
  /** Its last few stakes against the base stake, oldest first. */
  recentStakeMultiples: number[];
  roundsSurvived: number;
  wins: number;
  at: string;
}

/**
 * Whether this reads as over-reaching rather than simply running out.
 *
 * Borrowed chips, or stakes above the base, mean it was pushing. A record
 * without either is an agent that played within itself and still lost, which
 * is a different story and should not be told as the same one.
 */
export function overReached(record: WreckRecord): boolean {
  if (BigInt(record.borrowedWei) > 0n) return true;
  return record.recentStakeMultiples.some((m) => m > 1);
}

interface FileShape {
  version: 1;
  wrecks: WreckRecord[];
  updatedAt: string;
}

export class WreckStore {
  private records: WreckRecord[] = [];
  /** The file as last read: modification time and size. Empty when absent. */
  private stamp = "";

  constructor(private readonly file: string) {
    this.reload();
  }

  /**
   * Rereads the file when it has changed since the last look.
   *
   * The graveyard is served from the server context and written from the
   * settle context, both in one process and each with its own store over this
   * file. Read once at construction, the wall never grew: a round settled
   * while the page was open left no mark on it until a restart.
   */
  private reload(): void {
    const stat = statSync(this.file, { throwIfNoEntry: false });
    const now = stat ? `${stat.mtimeMs}:${stat.size}` : "";
    if (now === this.stamp) return;
    this.stamp = now;
    this.records = [];
    if (!stat) return;
    const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<FileShape>;
    if (Array.isArray(parsed.wrecks)) this.records = parsed.wrecks;
  }

  /** Records a wreck, or replaces the one already on file for that round. */
  save(record: WreckRecord): void {
    this.reload();
    const i = this.records.findIndex((r) => r.roundId === record.roundId && r.walletId === record.walletId);
    if (i >= 0) this.records[i] = record;
    else this.records.push(record);
    this.flush();
  }

  /** Whether this wallet has already been wrecked out of this round. */
  has(roundId: string, walletId: string): boolean {
    this.reload();
    return this.records.some((r) => r.roundId === roundId && r.walletId === walletId);
  }

  all(): WreckRecord[] {
    this.reload();
    return [...this.records];
  }

  /** How many times this seat has been emptied, which sets the next identity. */
  countFor(walletId: string): number {
    this.reload();
    return this.records.filter((r) => r.walletId === walletId).length;
  }

  private flush(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const body: FileShape = { version: 1, wrecks: this.records, updatedAt: new Date().toISOString() };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n");
    renameSync(tmp, this.file);
    // This store is now the file, so the next read has nothing to pick up.
    const stat = statSync(this.file, { throwIfNoEntry: false });
    this.stamp = stat ? `${stat.mtimeMs}:${stat.size}` : "";
  }
}
