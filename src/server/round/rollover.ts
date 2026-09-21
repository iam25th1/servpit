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

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertWei } from "../money";

interface FileShape {
  version: 1;
  /** Carried into the next round. Decimal wei, because bigint has no JSON form. */
  rolloverWei: string;
  /** The round that last consumed a rollover. */
  lastRoundId: string | null;
  /** What that round consumed, so a replay of it reads the same number. */
  lastInputWei: string;
  updatedAt: string;
}

export class RolloverStore {
  private rollover = 0n;
  private lastRoundId: string | null = null;
  private lastInput = 0n;

  constructor(private readonly file: string) {
    if (!existsSync(file)) return;
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<FileShape>;
    if (typeof parsed.rolloverWei === "string" && /^\d+$/.test(parsed.rolloverWei)) this.rollover = BigInt(parsed.rolloverWei);
    if (typeof parsed.lastRoundId === "string") this.lastRoundId = parsed.lastRoundId;
    if (typeof parsed.lastInputWei === "string" && /^\d+$/.test(parsed.lastInputWei)) this.lastInput = BigInt(parsed.lastInputWei);
  }

  /** Carried into the next round that has not run yet. */
  get carriedWei(): bigint {
    return this.rollover;
  }

  /** What this round adds to its pool. Stable across replays of the same round. */
  inputFor(roundId: string): bigint {
    return roundId === this.lastRoundId ? this.lastInput : this.rollover;
  }

  /** Records what the round consumed and what it left behind. */
  record(roundId: string, inputWei: bigint, nextRolloverWei: bigint): void {
    assertWei(inputWei, "inputWei");
    assertWei(nextRolloverWei, "nextRolloverWei");
    if (roundId === this.lastRoundId && inputWei !== this.lastInput) {
      throw new Error(`round ${roundId} already consumed ${this.lastInput} wei of rollover, refusing to record ${inputWei}`);
    }
    this.lastRoundId = roundId;
    this.lastInput = inputWei;
    this.rollover = nextRolloverWei;
    this.flush();
  }

  private flush(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const body: FileShape = {
      version: 1,
      rolloverWei: this.rollover.toString(),
      lastRoundId: this.lastRoundId,
      lastInputWei: this.lastInput.toString(),
      updatedAt: new Date().toISOString(),
    };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n");
    renameSync(tmp, this.file);
  }
}
