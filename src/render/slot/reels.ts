// Three reel state machine. Time arrives only through advance(deltaMs) from
// the shared loop; nothing here schedules anything.
//
// Each reel runs the same script: accelerate, hold full speed, then ease onto
// its target symbol. What differs is when the ease starts. Reel 1 stops at
// firstStopMs, reel 2 a beat later, reel 3 a longer beat after that, plus the
// near miss hold when reels 1 and 2 landed on the same symbol. That hold is
// the whole trick: the two matching symbols are already visible, so the extra
// beat on reel 3 is the player doing the arithmetic before the machine does.

import type { SlotConfig } from "@/config/slot";

export type ReelSetState = "idle" | "spinning" | "settled";

export interface WindowCell {
  symbol: string;
  /** Offset from the centre row, in symbol heights. Fractional while moving. */
  row: number;
}

export interface ReelState {
  index: number;
  /** Strip position in symbols. The fractional part is the scroll within a cell. */
  offset: number;
  /** Total symbols travelled since the pull started. Never decreases. */
  travelled: number;
  /** Symbols per second. Drives the smear; zero when at rest. */
  speed: number;
  stopped: boolean;
  /** Symbol resting in the centre row. */
  symbol: string;
  /** Symbols visible in the window, top to bottom. */
  window: WindowCell[];
}

type StopListener = (index: number) => void;

interface Reel {
  index: number;
  offset: number;
  travelled: number;
  speed: number;
  stopped: boolean;
  targetIndex: number;
  /** Elapsed milliseconds at which this reel begins easing down. */
  easeAtMs: number;
  /** Strip position it eases to. Set when the ease begins. */
  restOffset: number | null;
  easeFromOffset: number;
  easeElapsedMs: number;
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInOutSine = (t: number): number => 0.5 - Math.cos(Math.PI * t) / 2;
const mod = (a: number, n: number): number => ((a % n) + n) % n;

export class ReelSet {
  private readonly reels: Reel[];
  private readonly listeners: StopListener[] = [];
  private elapsedMs = 0;
  private status: ReelSetState = "idle";
  private nearMissHold = false;

  constructor(
    private readonly config: SlotConfig,
    private readonly symbols: readonly string[],
  ) {
    if (symbols.length < 3) throw new RangeError("a reel strip needs at least three symbols");
    this.reels = [0, 1, 2].map((index) => ({
      index,
      offset: 0,
      travelled: 0,
      speed: 0,
      stopped: true,
      targetIndex: 0,
      easeAtMs: 0,
      restOffset: 0,
      easeFromOffset: 0,
      easeElapsedMs: 0,
    }));
  }

  get state(): ReelSetState {
    return this.status;
  }

  get settled(): boolean {
    return this.status !== "spinning";
  }

  /** True when reels 1 and 2 land on the same symbol, so reel 3 holds longer. */
  get nearMiss(): boolean {
    return this.nearMissHold;
  }

  onStop(listener: StopListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /**
   * Begins a pull toward the three target symbols. seed only varies the
   * starting positions, so the same seed gives the same visible spin.
   */
  start(targets: readonly [string, string, string], seed: number): void {
    if (this.status === "spinning") return;
    const indexes = targets.map((symbol) => {
      const i = this.symbols.indexOf(symbol);
      if (i < 0) throw new RangeError(`symbol ${symbol} is not on the reel strip`);
      return i;
    });

    const r = this.config.reels;
    this.nearMissHold = targets[0] === targets[1];
    const stopAt = [
      r.firstStopMs,
      r.firstStopMs + r.gapBeforeReel2Ms,
      r.firstStopMs + r.gapBeforeReel2Ms + r.gapBeforeReel3Ms + (this.nearMissHold ? r.nearMissHoldMs : 0),
    ];

    this.elapsedMs = 0;
    this.status = "spinning";
    this.reels.forEach((reel, i) => {
      reel.offset = mod(seed * 3 + i * 7, this.symbols.length);
      reel.travelled = 0;
      reel.speed = 0;
      reel.stopped = false;
      reel.targetIndex = indexes[i];
      // stopAt is when the reel comes to rest, so the ease starts before it.
      reel.easeAtMs = Math.max(0, stopAt[i] - r.settleMs);
      reel.restOffset = null;
      reel.easeFromOffset = reel.offset;
      reel.easeElapsedMs = 0;
    });
  }

  /**
   * Changes where the reels will land while they are still at full speed. The
   * machine starts spinning the moment the lever releases, so the answer can
   * arrive from the server a beat later without restarting anything. Only a
   * reel that has already begun easing down is out of reach.
   */
  retarget(targets: readonly [string, string, string]): boolean {
    if (this.status !== "spinning") return false;
    if (this.reels.some((reel) => reel.restOffset !== null || reel.stopped)) return false;
    const indexes = targets.map((symbol) => {
      const i = this.symbols.indexOf(symbol);
      if (i < 0) throw new RangeError(`symbol ${symbol} is not on the reel strip`);
      return i;
    });
    const wasNearMiss = this.nearMissHold;
    this.nearMissHold = targets[0] === targets[1];
    this.reels.forEach((reel, i) => {
      reel.targetIndex = indexes[i];
    });
    // Reel 3's stop moment depends on the first two matching, so it moves too.
    if (this.nearMissHold !== wasNearMiss) {
      this.reels[2].easeAtMs += (this.nearMissHold ? 1 : -1) * this.config.reels.nearMissHoldMs;
    }
    return true;
  }

  reset(): void {
    this.status = "idle";
    this.elapsedMs = 0;
    this.nearMissHold = false;
    for (const reel of this.reels) {
      reel.speed = 0;
      reel.stopped = true;
      reel.easeElapsedMs = 0;
    }
  }

  advance(deltaMs: number): void {
    if (this.status !== "spinning" || !(deltaMs > 0)) return;
    const r = this.config.reels;
    this.elapsedMs += deltaMs;
    const seconds = deltaMs / 1000;

    for (const reel of this.reels) {
      if (reel.stopped) continue;

      if (this.elapsedMs < reel.easeAtMs) {
        // Spin up, then hold.
        const spinUp = r.spinUpMs > 0 ? Math.min(1, this.elapsedMs / r.spinUpMs) : 1;
        reel.speed = r.spinSymbolsPerSecond * easeOutCubic(spinUp);
        const moved = reel.speed * seconds;
        reel.offset = mod(reel.offset + moved, this.symbols.length);
        reel.travelled += moved;
        continue;
      }

      if (reel.restOffset === null) {
        // Lock the landing: the nearest strip position ahead whose centre cell
        // is the target symbol, plus a full turn so the ease always moves on.
        const ahead = mod(reel.targetIndex - reel.offset, this.symbols.length);
        reel.restOffset = reel.offset + ahead + this.symbols.length;
        reel.easeFromOffset = reel.offset;
        reel.easeElapsedMs = 0;
      }

      reel.easeElapsedMs += deltaMs;
      const t = r.settleMs > 0 ? Math.min(1, reel.easeElapsedMs / r.settleMs) : 1;
      const span = reel.restOffset - reel.easeFromOffset;
      const previous = reel.offset;
      const raw = reel.easeFromOffset + span * easeInOutSine(t);
      const stepped = raw - previous;
      reel.travelled += stepped >= 0 ? stepped : stepped + this.symbols.length;
      reel.offset = mod(raw, this.symbols.length);
      reel.speed = t >= 1 ? 0 : (span / Math.max(1, r.settleMs)) * 1000 * Math.sin(Math.PI * t);

      if (t >= 1) {
        reel.offset = mod(reel.restOffset, this.symbols.length);
        reel.speed = 0;
        reel.stopped = true;
        for (const listener of [...this.listeners]) listener(reel.index);
      }
    }

    if (this.reels.every((reel) => reel.stopped)) this.status = "settled";
  }

  /** Current state of each reel, for drawing. */
  reelStates(): ReelState[] {
    const radius = this.config.reels.stripRadius;
    return this.reels.map((reel) => {
      const window: WindowCell[] = [];
      for (let row = -radius; row <= radius; row++) {
        const index = mod(Math.round(reel.offset) + row, this.symbols.length);
        window.push({ symbol: this.symbols[index], row: row + (Math.round(reel.offset) - reel.offset) });
      }
      return {
        index: reel.index,
        offset: reel.offset,
        travelled: reel.travelled,
        speed: reel.speed,
        stopped: reel.stopped,
        symbol: this.symbols[mod(Math.round(reel.offset), this.symbols.length)],
        window,
      };
    });
  }
}
