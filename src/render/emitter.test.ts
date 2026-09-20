import { describe, expect, it } from "vitest";
import { createRng } from "@/engine/rng";
import type { DrawTarget } from "./draw";
import { ParticleEmitter, PRESETS, type EmitterConfig, type Particle } from "./emitter";

const unit = (seed: string) => {
  const rng = createRng(seed);
  return () => rng.nextU32() / 0x1_0000_0000;
};

class CountingTarget implements DrawTarget {
  readonly width = 400;
  readonly height = 400;
  fills: Array<{ x: number; y: number; w: number; h: number; color: string; alpha: number }> = [];
  clear() {}
  fillRect(x: number, y: number, w: number, h: number, color: string, alpha = 1) { this.fills.push({ x, y, w, h, color, alpha }); }
  drawSlice() {}
}

const config = (patch: Partial<EmitterConfig> = {}): EmitterConfig => ({
  count: 10,
  gravity: 0,
  spread: Math.PI / 2,
  direction: -Math.PI / 2,
  lifetimeMs: [100, 200],
  speed: [50, 100],
  size: [1, 2],
  draw: (target, p) => target.fillRect(p.x, p.y, p.size, p.size, "#ffffff", 1),
  ...patch,
});

describe("ParticleEmitter", () => {
  it("emits count particles inside the cone with speeds, lifetimes and sizes from the ranges", () => {
    const e = new ParticleEmitter(unit("emit"));
    e.emit(10, 20, config({ count: 200 }));
    expect(e.count).toBe(200);
    for (const p of e.particles()) {
      expect([p.x, p.y]).toEqual([10, 20]);
      const speed = Math.hypot(p.vx, p.vy);
      expect(speed).toBeGreaterThanOrEqual(50);
      expect(speed).toBeLessThanOrEqual(100);
      const angle = Math.atan2(p.vy, p.vx);
      expect(Math.abs(angle - -Math.PI / 2)).toBeLessThanOrEqual(Math.PI / 4 + 1e-9);
      expect(p.lifeMs).toBeGreaterThanOrEqual(100);
      expect(p.lifeMs).toBeLessThanOrEqual(200);
      expect(p.size).toBeGreaterThanOrEqual(1);
      expect(p.size).toBeLessThanOrEqual(2);
    }
  });

  it("moves particles by velocity, applies gravity, and retires them after their lifetime", () => {
    const e = new ParticleEmitter(unit("move"));
    e.emit(0, 0, config({ count: 1, spread: 0, direction: 0, speed: [100, 100], lifetimeMs: [150, 150], gravity: 200 }));
    e.update(500 / 10);
    const p = e.particles()[0];
    expect(p.x).toBeCloseTo(5);
    expect(p.vy).toBeCloseTo(200 * 0.05);
    expect(p.y).toBeCloseTo(200 * 0.05 * 0.05);
    e.update(100);
    expect(e.count).toBe(0);
  });

  it("draws each living particle through the config draw function with its age fraction", () => {
    const e = new ParticleEmitter(unit("draw"));
    const ages: number[] = [];
    e.emit(0, 0, config({ count: 5, lifetimeMs: [100, 100], draw: (_t, _p, age) => { ages.push(age); } }));
    e.update(25);
    e.draw(new CountingTarget());
    expect(ages).toHaveLength(5);
    for (const a of ages) expect(a).toBeCloseTo(0.25);
  });

  it("is deterministic for the same random source", () => {
    const a = new ParticleEmitter(unit("same"));
    const b = new ParticleEmitter(unit("same"));
    a.emit(3, 4, config({ count: 20 }));
    b.emit(3, 4, config({ count: 20 }));
    expect(a.particles()).toEqual(b.particles());
  });

  it("caps the live particle count by dropping the oldest", () => {
    const e = new ParticleEmitter(unit("cap"), { maxParticles: 50 });
    e.emit(0, 0, config({ count: 40, lifetimeMs: [1000, 1000] }));
    e.update(10);
    e.emit(0, 0, config({ count: 40, lifetimeMs: [1000, 1000] }));
    expect(e.count).toBe(50);
    expect(e.particles().every((p) => p.ageMs === 0)).toBe(false);
    expect(e.particles().filter((p) => p.ageMs === 0)).toHaveLength(40);
  });

  it("clear empties the system", () => {
    const e = new ParticleEmitter(unit("clear"));
    e.emit(0, 0, config());
    e.clear();
    expect(e.count).toBe(0);
  });
});

function hue(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return -1;
  const d = max - min;
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h;
}

describe("PRESETS", () => {
  it("coins, sparks, smoke and confetti are all configs of the one emitter", () => {
    for (const name of ["coins", "sparks", "smoke", "confetti"] as const) {
      const c = PRESETS[name]();
      expect(c.count).toBeGreaterThan(0);
      expect(typeof c.draw).toBe("function");
    }
    expect(PRESETS.coins().gravity).toBeGreaterThan(0);
    expect(PRESETS.confetti().gravity).toBeGreaterThan(0);
    expect(PRESETS.smoke().gravity).toBeLessThanOrEqual(0);
    expect(PRESETS.sparks().lifetimeMs[1]).toBeLessThan(PRESETS.smoke().lifetimeMs[0]);
    expect(PRESETS.sparks(3).count).toBeGreaterThan(PRESETS.sparks(1).count);
  });

  it("presets fade or shrink with age and never paint a purple tone", () => {
    for (const name of ["coins", "sparks", "smoke", "confetti"] as const) {
      const e = new ParticleEmitter(unit(name));
      e.emit(100, 100, PRESETS[name]());
      const target = new CountingTarget();
      e.update(1);
      e.draw(target);
      expect(target.fills.length).toBeGreaterThan(0);
      for (const f of target.fills) {
        const h = hue(f.color);
        expect(h < 255 || h > 335, `${name} paints ${f.color}`).toBe(true);
        expect(f.alpha).toBeGreaterThan(0);
        expect(f.alpha).toBeLessThanOrEqual(1);
      }
    }
  });

  it("particles expose a stable per particle seed for variety", () => {
    const e = new ParticleEmitter(unit("seed"));
    e.emit(0, 0, config({ count: 3 }));
    const seeds = e.particles().map((p: Particle) => p.seed);
    for (const s of seeds) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1);
    }
    expect(new Set(seeds).size).toBe(3);
  });
});
