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

import { StoreFile, UNKNOWN_NETWORK } from "../store/file";

/** The condition the rules module fired on. */
export type WreckTrigger = "debt above the ceiling" | "broke and denied credit";

export interface WreckRecord {
  roundId: string;
  walletId: string;
  identityId: string;
  name: string;
  /** The face it wore. Absent on a record written before faces were kept. */
  face?: string | null;
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

export class WreckStore {
  private records: WreckRecord[] = [];
  private readonly sync: StoreFile;

  /**
   * The graveyard is served from the server context and written from the
   * settle context, both in one process and each with its own store over this
   * file. Read once at construction, the wall never grew: a round settled
   * while the page was open left no mark on it until a restart.
   */
  constructor(file: string, network: string = UNKNOWN_NETWORK) {
    this.sync = new StoreFile(file, network, (body) => {
      this.records = Array.isArray(body?.wrecks) ? (body.wrecks as WreckRecord[]) : [];
    });
    this.sync.read();
  }

  /** Records a wreck, or replaces the one already on file for that round. */
  save(record: WreckRecord): void {
    this.sync.read();
    const i = this.records.findIndex((r) => r.roundId === record.roundId && r.walletId === record.walletId);
    if (i >= 0) this.records[i] = record;
    else this.records.push(record);
    this.flush();
  }

  /** Whether this wallet has already been wrecked out of this round. */
  has(roundId: string, walletId: string): boolean {
    this.sync.read();
    return this.records.some((r) => r.roundId === roundId && r.walletId === walletId);
  }

  all(): WreckRecord[] {
    this.sync.read();
    return [...this.records];
  }

  /** How many times this seat has been emptied, which sets the next identity. */
  countFor(walletId: string): number {
    this.sync.read();
    return this.records.filter((r) => r.walletId === walletId).length;
  }

  private flush(): void {
    this.sync.write({ version: 1, wrecks: this.records, updatedAt: new Date().toISOString() });
  }
}
