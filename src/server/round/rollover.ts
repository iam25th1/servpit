// What the pot carries into the next round.
//
// A round no real agent wins leaves its prize where it already is: in the
// pot. That money is the next round's jackpot, so it has to survive a
// restart and be readable by the round that inherits it.
//
// This is not the pot's balance. The pot wallet also holds a reserve that
// predates the solvent prize, which pays gas and is never part of a prize.
// Rollover is the earmarked part and only this file tracks it.
//
// Settling is idempotent by round id, so reading the rollover has to be too.
// The round that consumed a rollover is recorded alongside it: replaying that
// round reads the same input and recomputes the same prize, rather than
// reading the output of its own first run and paying a different number.

import { StoreFile, UNKNOWN_NETWORK } from "../store/file";
import { assertWei } from "../money";


export class RolloverStore {
  private rollover = 0n;
  private lastRoundId: string | null = null;
  private lastInput = 0n;
  private readonly sync: StoreFile;

  constructor(file: string, network: string = UNKNOWN_NETWORK) {
    this.sync = new StoreFile(file, network, (body) => this.load(body));
    this.sync.read();
  }

  private load(body: Record<string, unknown> | null): void {
    const rolloverWei = body?.rolloverWei;
    const lastRoundId = body?.lastRoundId;
    const lastInputWei = body?.lastInputWei;
    this.rollover = typeof rolloverWei === "string" && /^\d+$/.test(rolloverWei) ? BigInt(rolloverWei) : 0n;
    this.lastRoundId = typeof lastRoundId === "string" ? lastRoundId : null;
    this.lastInput = typeof lastInputWei === "string" && /^\d+$/.test(lastInputWei) ? BigInt(lastInputWei) : 0n;
  }

  /** Carried into the next round that has not run yet. */
  get carriedWei(): bigint {
    this.sync.read();
    return this.rollover;
  }

  /** What this round adds to its pool. Stable across replays of the same round. */
  inputFor(roundId: string): bigint {
    this.sync.read();
    return roundId === this.lastRoundId ? this.lastInput : this.rollover;
  }

  /** Records what the round consumed and what it left behind. */
  record(roundId: string, inputWei: bigint, nextRolloverWei: bigint): void {
    assertWei(inputWei, "inputWei");
    assertWei(nextRolloverWei, "nextRolloverWei");
    // Against what is on file now, not against what was there when this
    // store was built: another writer may have settled a round since.
    this.sync.read();
    if (roundId === this.lastRoundId && inputWei !== this.lastInput) {
      throw new Error(`round ${roundId} already consumed ${this.lastInput} wei of rollover, refusing to record ${inputWei}`);
    }
    this.lastRoundId = roundId;
    this.lastInput = inputWei;
    this.rollover = nextRolloverWei;
    this.flush();
  }

  private flush(): void {
    this.sync.write({
      version: 1,
      rolloverWei: this.rollover.toString(),
      lastRoundId: this.lastRoundId,
      lastInputWei: this.lastInput.toString(),
      updatedAt: new Date().toISOString(),
    });
  }
}
