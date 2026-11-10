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

import { graveyardOptions, type GraveyardOptions } from "@/config/graveyard";
import { UNKNOWN_NETWORK } from "../store/file";
import { GraveyardCache, appendWreck, graveyardPaths, type GraveyardPaths } from "./graveyard";

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
  private readonly paths: GraveyardPaths;
  private readonly cache: GraveyardCache;

  /**
   * The graveyard is served from the server context and written from the
   * settle context, both in one process and each with its own store over
   * these files. Every read checks the files first, so a round settled while
   * the page was open is on the wall without a restart.
   *
   * Opened on the old single file name, wrecks-<network>.json, which is still
   * read while it is there. New retirements go to the files beside it; see
   * graveyard.ts.
   */
  constructor(
    file: string,
    private readonly network: string = UNKNOWN_NETWORK,
    private readonly options: GraveyardOptions = graveyardOptions(),
  ) {
    this.paths = graveyardPaths(file);
    this.cache = new GraveyardCache(this.paths, network);
    // Read once now, so a graveyard from another network refuses to open
    // rather than refusing the first retirement.
    this.cache.records();
  }

  /** Records a wreck. A second record for the same round and seat replaces the first when read. */
  save(record: WreckRecord): void {
    appendWreck(this.paths, this.network, record, this.options);
  }

  /** Whether this wallet has already been wrecked out of this round. */
  has(roundId: string, walletId: string): boolean {
    return this.cache.records().some((r) => r.roundId === roundId && r.walletId === walletId);
  }

  all(): WreckRecord[] {
    return [...this.cache.records()];
  }

  /** How many agents were retired at or after this moment, in epoch ms. */
  countSince(sinceMs: number): number {
    return this.cache.records().filter((r) => Date.parse(r.at) >= sinceMs).length;
  }

  /** The most recent retirement from this seat, or null when it has had none. */
  lastFor(walletId: string): WreckRecord | null {
    let last: WreckRecord | null = null;
    for (const r of this.cache.records()) {
      if (r.walletId === walletId && (last === null || Date.parse(r.at) >= Date.parse(last.at))) last = r;
    }
    return last;
  }

  /** How many times this seat has been emptied, which sets the next identity. */
  countFor(walletId: string): number {
    return this.cache.records().filter((r) => r.walletId === walletId).length;
  }
}
