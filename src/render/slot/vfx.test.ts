import { describe, expect, it } from "vitest";
import { createRng } from "@/engine/rng";
import type { DrawTarget } from "../draw";
import { ParticleEmitter } from "../emitter";
import { SLOT_EMITTERS, SlotVfx, TIER_PAYOFF, shineOffsetAt } from "./vfx";
import { SLOT_LAYOUT } from "./layout";

type Fill = { x: number; y: number; w: number; h: number; color: string; alpha: number };

class RecordingTarget implements DrawTarget {
  fills: Fill[] = [];
  readonly width = SLOT_LAYOUT.width;
  readonly height = SLOT_LAYOUT.height;
  clear() {}
  fillRect(x: number, y: number, w: number, h: number, color: string, alpha = 1) { this.fills.push({ x, y, w, h, color, alpha }); }
  drawSlice() {}
}

const unit = (seed: string) => {
  const rng = createRng(seed);
  return () => rng.nextU32() / 0x1_0000_0000;
};

const hue = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return -1;
  const d = max - min;
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};

const makeVfx = (seed = "vfx") => new SlotVfx(new ParticleEmitter(unit(seed)));

describe("flash ring", () => {
  it("expands, thins its stroke as the radius grows, and fades inverse to radius", () => {
    const vfx = makeVfx();
    vfx.flashRing(100, 80, 1);
    const sample = () => {
      const t = new RecordingTarget();
      vfx.draw(t);
      const ring = t.fills;
      const cx = 100;
      const radii = ring.map((f) => Math.hypot(f.x + f.w / 2 - cx, f.y + f.h / 2 - 80));
      return { radius: radii.reduce((a, b) => a + b, 0) / radii.length, stroke: ring[0].w, alpha: ring[0].alpha, count: ring.length };
    };
    vfx.advance(16);
    const early = sample();
    vfx.advance(200);
    const late = sample();
    expect(late.radius).toBeGreaterThan(early.radius);
    expect(late.stroke).toBeLessThanOrEqual(early.stroke);
    expect(late.alpha).toBeLessThan(early.alpha);
    expect(early.count).toBeGreaterThan(8);
  });

  it("retires when it has fully expanded, leaving nothing behind", () => {
    const vfx = makeVfx();
    vfx.flashRing(50, 50, 1);
    vfx.advance(5_000);
    const t = new RecordingTarget();
    vfx.draw(t);
    expect(t.fills).toHaveLength(0);
    expect(vfx.activeRings).toBe(0);
  });

  it("scales with intensity so a rare stop rings wider than a common one", () => {
    const widest = (intensity: number) => {
      const vfx = makeVfx();
      vfx.flashRing(100, 80, intensity);
      vfx.advance(150);
      const t = new RecordingTarget();
      vfx.draw(t);
      return Math.max(...t.fills.map((f) => Math.hypot(f.x + f.w / 2 - 100, f.y + f.h / 2 - 80)));
    };
    expect(widest(2)).toBeGreaterThan(widest(1));
  });
});

describe("coin burst", () => {
  it("is a config for the shared emitter, with gravity and horizontal spread", () => {
    const config = SLOT_EMITTERS.coinBurst(1);
    expect(config.gravity).toBeGreaterThan(0);
    expect(config.spread).toBeGreaterThan(0);
    expect(config.count).toBeGreaterThan(0);
    expect(typeof config.draw).toBe("function");
    expect(SLOT_EMITTERS.coinBurst(3).count).toBeGreaterThan(SLOT_EMITTERS.coinBurst(1).count);
  });

  it("arcs: coins rise then fall under gravity", () => {
    const emitter = new ParticleEmitter(unit("arc"));
    emitter.emit(100, 100, SLOT_EMITTERS.coinBurst(2));
    const heights: number[] = [];
    for (let i = 0; i < 40; i++) {
      emitter.update(16);
      const ys = emitter.particles().map((p) => p.y);
      if (ys.length) heights.push(Math.min(...ys));
    }
    const lowestY = Math.min(...heights);
    expect(lowestY).toBeLessThan(100);
    expect(heights[heights.length - 1]).toBeGreaterThan(lowestY);
  });

  it("paints two tones of gold, flat, never a purple tone", () => {
    const emitter = new ParticleEmitter(unit("gold"));
    emitter.emit(100, 100, SLOT_EMITTERS.coinBurst(3));
    emitter.update(16);
    const t = new RecordingTarget();
    emitter.draw(t);
    const tones = new Set(t.fills.map((f) => f.color));
    expect(tones.size).toBe(2);
    for (const color of tones) {
      const h = hue(color);
      expect(h < 255 || h > 335, `coin paints ${color}`).toBe(true);
      expect(h).toBeGreaterThan(20);
      expect(h).toBeLessThan(70);
    }
  });

  it("holds full alpha then fades only in the last fifth of life", () => {
    const config = SLOT_EMITTERS.coinBurst(1);
    const alphaAt = (age: number) => {
      const t = new RecordingTarget();
      config.draw(t, { x: 10, y: 10, vx: 0, vy: 0, ageMs: 0, lifeMs: 1, size: 3, seed: 0.1 }, age);
      return t.fills[0].alpha;
    };
    expect(alphaAt(0.1)).toBe(1);
    expect(alphaAt(0.79)).toBe(1);
    expect(alphaAt(0.9)).toBeLessThan(1);
    expect(alphaAt(0.99)).toBeLessThan(alphaAt(0.9));
    expect(alphaAt(0.99)).toBeGreaterThan(0);
  });
});

describe("shine sweep", () => {
  it("travels across the reel window and clips to its bounds", () => {
    const vfx = makeVfx();
    const w = SLOT_LAYOUT.window;
    vfx.shineSweep(w);
    const xsAt = (ms: number) => {
      vfx.advance(ms);
      const t = new RecordingTarget();
      vfx.draw(t);
      return t.fills;
    };
    const early = xsAt(60);
    const late = xsAt(300);
    expect(early.length).toBeGreaterThan(0);
    const mid = (fills: Fill[]) => fills.reduce((a, f) => a + f.x, 0) / fills.length;
    expect(mid(late)).toBeGreaterThan(mid(early));
    for (const f of [...early, ...late]) {
      expect(f.x).toBeGreaterThanOrEqual(w.x);
      expect(f.x + f.w).toBeLessThanOrEqual(w.x + w.width + 1e-9);
      expect(f.y).toBeGreaterThanOrEqual(w.y);
      expect(f.y + f.h).toBeLessThanOrEqual(w.y + w.height + 1e-9);
    }
  });

  it("is a low alpha white slant, not a bright wipe", () => {
    const vfx = makeVfx();
    vfx.shineSweep(SLOT_LAYOUT.window);
    vfx.advance(100);
    const t = new RecordingTarget();
    vfx.draw(t);
    for (const f of t.fills) {
      expect(f.color).toBe("#ffffff");
      expect(f.alpha).toBeLessThanOrEqual(0.2);
      expect(f.alpha).toBeGreaterThan(0);
    }
  });

  it("slants at 20 degrees: each scanline shifts by tan(20 degrees)", () => {
    const shift = shineOffsetAt(10) - shineOffsetAt(0);
    expect(shift / 10).toBeCloseTo(Math.tan((20 * Math.PI) / 180), 3);
  });

  it("retires after it leaves the window", () => {
    const vfx = makeVfx();
    vfx.shineSweep(SLOT_LAYOUT.window);
    vfx.advance(5_000);
    const t = new RecordingTarget();
    vfx.draw(t);
    expect(t.fills).toHaveLength(0);
  });
});

describe("tiered payoff", () => {
  it("gives a rare landing more than a common one, and a three of a kind the most", () => {
    const common = TIER_PAYOFF({ tier: "common", combo: "none" });
    const rare = TIER_PAYOFF({ tier: "rare", combo: "none" });
    const jackpot = TIER_PAYOFF({ tier: "rare", combo: "threeOfAKind" });
    expect(rare.rings).toBeGreaterThan(common.rings);
    expect(rare.coinIntensity).toBeGreaterThan(common.coinIntensity);
    expect(jackpot.coinIntensity).toBeGreaterThan(rare.coinIntensity);
    expect(jackpot.shine).toBe(true);
    expect(common.shine).toBe(false);
    expect(jackpot.reverseBulbs).toBe(true);
  });

  it("treats a pair as better than nothing but short of the full treatment", () => {
    const pair = TIER_PAYOFF({ tier: "common", combo: "pair" });
    const none = TIER_PAYOFF({ tier: "common", combo: "none" });
    const jackpot = TIER_PAYOFF({ tier: "common", combo: "threeOfAKind" });
    expect(pair.coinIntensity).toBeGreaterThan(none.coinIntensity);
    expect(pair.coinIntensity).toBeLessThan(jackpot.coinIntensity);
  });
});

describe("SlotVfx housekeeping", () => {
  it("drives the shared emitter rather than keeping a second particle system", () => {
    const emitter = new ParticleEmitter(unit("shared"));
    const vfx = new SlotVfx(emitter);
    vfx.coinBurst(60, 60, 2);
    expect(emitter.count).toBeGreaterThan(0);
    vfx.advance(16);
    const t = new RecordingTarget();
    vfx.draw(t);
    expect(t.fills.length).toBeGreaterThan(0);
  });

  it("clear removes rings, sweeps and particles together", () => {
    const emitter = new ParticleEmitter(unit("clear"));
    const vfx = new SlotVfx(emitter);
    vfx.flashRing(10, 10, 1);
    vfx.shineSweep(SLOT_LAYOUT.window);
    vfx.coinBurst(10, 10, 1);
    vfx.clear();
    const t = new RecordingTarget();
    vfx.draw(t);
    expect(t.fills).toHaveLength(0);
    expect(emitter.count).toBe(0);
  });

  it("paints nothing in the purple range across every effect", () => {
    const emitter = new ParticleEmitter(unit("hue"));
    const vfx = new SlotVfx(emitter);
    vfx.flashRing(80, 80, 2);
    vfx.shineSweep(SLOT_LAYOUT.window);
    vfx.coinBurst(80, 80, 3);
    vfx.advance(50);
    const t = new RecordingTarget();
    vfx.draw(t);
    expect(t.fills.length).toBeGreaterThan(0);
    for (const f of t.fills) {
      const h = hue(f.color);
      expect(h < 255 || h > 335, `vfx paints ${f.color}`).toBe(true);
    }
  });
});
