import { describe, expect, it } from "vitest";
import { DEFAULT_SLOT, type SlotConfig } from "@/config/slot";
import { ReelSet } from "./reels";

const SYMBOLS = ["NinjaRed", "NinjaBlue", "Knight", "Monk", "Hunter", "Boy", "Eskimo", "Caveman", "Bear", "Dragon"];
const config = (patch: Partial<SlotConfig["reels"]> = {}): SlotConfig => ({
  ...DEFAULT_SLOT,
  reels: { ...DEFAULT_SLOT.reels, ...patch },
});

const run = (set: ReelSet, ms: number, step = 16): void => {
  for (let t = 0; t < ms; t += step) set.advance(step);
};

describe("ReelSet lifecycle", () => {
  it("starts idle, showing the given symbols, with nothing moving", () => {
    const set = new ReelSet(DEFAULT_SLOT, SYMBOLS);
    expect(set.state).toBe("idle");
    expect(set.settled).toBe(true);
    for (const reel of set.reelStates()) {
      expect(reel.stopped).toBe(true);
      expect(reel.speed).toBe(0);
    }
  });

  it("rejects a target symbol that is not on the strip", () => {
    const set = new ReelSet(DEFAULT_SLOT, SYMBOLS);
    expect(() => set.start(["Knight", "Monk", "NotASymbol"], 0)).toThrow(/NotASymbol/);
  });

  it("spins, then stops all three and lands exactly on the targets", () => {
    const set = new ReelSet(DEFAULT_SLOT, SYMBOLS);
    set.start(["Knight", "Monk", "Bear"], 0);
    expect(set.state).toBe("spinning");
    expect(set.settled).toBe(false);
    run(set, 6_000);
    expect(set.state).toBe("settled");
    expect(set.settled).toBe(true);
    expect(set.reelStates().map((r) => r.symbol)).toEqual(["Knight", "Monk", "Bear"]);
    for (const reel of set.reelStates()) {
      expect(reel.stopped).toBe(true);
      expect(reel.speed).toBe(0);
      // Rest position is exactly on a symbol boundary.
      expect(Math.abs(reel.offset - Math.round(reel.offset))).toBeLessThan(1e-9);
    }
  });
});

describe("ReelSet stop order and beats", () => {
  const stopTimes = (targets: [string, string, string], seed = 0): number[] => {
    const set = new ReelSet(DEFAULT_SLOT, SYMBOLS);
    const times: number[] = [];
    let elapsed = 0;
    set.onStop(() => times.push(elapsed));
    set.start(targets, seed);
    for (let i = 0; i < 500; i++) {
      elapsed += 16;
      set.advance(16);
    }
    return times;
  };

  it("stops one reel at a time, in order, never together", () => {
    const set = new ReelSet(DEFAULT_SLOT, SYMBOLS);
    const order: number[] = [];
    set.onStop((index) => order.push(index));
    set.start(["Knight", "Monk", "Bear"], 0);
    run(set, 6_000);
    expect(order).toEqual([0, 1, 2]);
  });

  it("leaves a longer beat before reel 3 than before reel 2", () => {
    const [t1, t2, t3] = stopTimes(["Knight", "Monk", "Bear"]);
    const gap2 = t2 - t1;
    const gap3 = t3 - t2;
    expect(gap2).toBeGreaterThan(0);
    expect(gap3).toBeGreaterThan(gap2);
    expect(gap2).toBeCloseTo(DEFAULT_SLOT.reels.gapBeforeReel2Ms, -2);
    expect(gap3).toBeCloseTo(DEFAULT_SLOT.reels.gapBeforeReel3Ms, -2);
  });

  it("holds reel 3 an extra beat when reels 1 and 2 match", () => {
    const plain = stopTimes(["Knight", "Monk", "Bear"]);
    const nearMiss = stopTimes(["Knight", "Knight", "Bear"]);
    expect(nearMiss[0]).toBeCloseTo(plain[0], -2);
    expect(nearMiss[1]).toBeCloseTo(plain[1], -2);
    const extra = nearMiss[2] - plain[2];
    expect(extra).toBeCloseTo(DEFAULT_SLOT.reels.nearMissHoldMs, -2);
  });

  it("holds for a three of a kind too, since reels 1 and 2 still match", () => {
    const plain = stopTimes(["Knight", "Monk", "Bear"]);
    const jackpot = stopTimes(["Bear", "Bear", "Bear"]);
    expect(jackpot[2] - plain[2]).toBeCloseTo(DEFAULT_SLOT.reels.nearMissHoldMs, -2);
    expect(jackpot[2]).toBeGreaterThan(jackpot[1]);
  });

  it("reports the near miss so the rest of the machine can react", () => {
    const set = new ReelSet(DEFAULT_SLOT, SYMBOLS);
    set.start(["Knight", "Knight", "Bear"], 0);
    expect(set.nearMiss).toBe(true);
    const other = new ReelSet(DEFAULT_SLOT, SYMBOLS);
    other.start(["Knight", "Monk", "Bear"], 0);
    expect(other.nearMiss).toBe(false);
  });

  it("all gaps come from config, so retuning changes the feel without code", () => {
    const fast = new ReelSet(config({ firstStopMs: 100, gapBeforeReel2Ms: 50, gapBeforeReel3Ms: 80, nearMissHoldMs: 0, settleMs: 10 }), SYMBOLS);
    const times: number[] = [];
    let elapsed = 0;
    fast.onStop(() => times.push(elapsed));
    fast.start(["Knight", "Monk", "Bear"], 0);
    for (let i = 0; i < 200; i++) {
      elapsed += 8;
      fast.advance(8);
    }
    expect(times[1] - times[0]).toBeLessThan(100);
    expect(times[2] - times[1]).toBeLessThan(140);
    expect(fast.settled).toBe(true);
  });
});

describe("ReelSet motion", () => {
  it("accelerates from rest, runs at the configured speed, then eases to zero", () => {
    const set = new ReelSet(DEFAULT_SLOT, SYMBOLS);
    set.start(["Knight", "Monk", "Bear"], 0);
    set.advance(16);
    const early = set.reelStates()[0].speed;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(DEFAULT_SLOT.reels.spinSymbolsPerSecond);
    run(set, 500);
    const full = set.reelStates()[0].speed;
    expect(full).toBeCloseTo(DEFAULT_SLOT.reels.spinSymbolsPerSecond, 1);
    run(set, 6_000);
    expect(set.reelStates()[0].speed).toBe(0);
  });

  it("moves the strip monotonically while spinning and never jumps backwards", () => {
    const set = new ReelSet(DEFAULT_SLOT, SYMBOLS);
    set.start(["Knight", "Monk", "Bear"], 0);
    let previous = set.reelStates()[2].travelled;
    for (let i = 0; i < 300; i++) {
      set.advance(16);
      const now = set.reelStates()[2].travelled;
      expect(now).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = now;
    }
  });

  it("exposes the symbols visible in the window so the strip can be drawn", () => {
    const set = new ReelSet(DEFAULT_SLOT, SYMBOLS);
    set.start(["Knight", "Monk", "Bear"], 0);
    run(set, 6_000);
    const window = set.reelStates()[0].window;
    const radius = DEFAULT_SLOT.reels.stripRadius;
    expect(window).toHaveLength(radius * 2 + 1);
    expect(window[radius].symbol).toBe("Knight");
    for (const cell of window) expect(SYMBOLS).toContain(cell.symbol);
  });

  it("is deterministic for the same seed and targets", () => {
    const snapshot = (seed: number) => {
      const set = new ReelSet(DEFAULT_SLOT, SYMBOLS);
      set.start(["Knight", "Monk", "Bear"], seed);
      run(set, 800);
      return set.reelStates().map((r) => [r.offset, r.speed]);
    };
    expect(snapshot(7)).toEqual(snapshot(7));
    expect(snapshot(7)).not.toEqual(snapshot(8));
  });

  it("ignores a second start while already spinning", () => {
    const set = new ReelSet(DEFAULT_SLOT, SYMBOLS);
    set.start(["Knight", "Monk", "Bear"], 0);
    run(set, 200);
    set.start(["Boy", "Boy", "Boy"], 0);
    run(set, 6_000);
    expect(set.reelStates().map((r) => r.symbol)).toEqual(["Knight", "Monk", "Bear"]);
  });

  it("can be reset back to idle for the next pull", () => {
    const set = new ReelSet(DEFAULT_SLOT, SYMBOLS);
    set.start(["Knight", "Monk", "Bear"], 0);
    run(set, 6_000);
    set.reset();
    expect(set.state).toBe("idle");
    set.start(["Boy", "Boy", "Boy"], 0);
    run(set, 6_000);
    expect(set.reelStates().map((r) => r.symbol)).toEqual(["Boy", "Boy", "Boy"]);
  });
});
