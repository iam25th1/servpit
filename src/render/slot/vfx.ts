// Slot visual effects. Particles go through the phase 2 ParticleEmitter with
// new configs; there is no second particle system here. The two effects that
// are not particles, the flash ring and the shine sweep, are short lived
// shapes advanced by the same delta.
//
// Everything is drawn with fillRect so it goes through the existing
// DrawTarget unchanged: the ring is squares stepped around a circumference,
// the sweep is scanlines offset by tan(20 degrees). No canvas filter, no
// blur, nothing that softens the frame.

import type { Tier } from "@/config/roster";
import type { Combo } from "@/engine/reels";
import type { DrawTarget } from "../draw";
import type { EmitterConfig, Particle, ParticleEmitter } from "../emitter";

const COIN_BRIGHT = "#ffd54f";
const COIN_DEEP = "#ffa000";
const RING = "#ffb300";
const SHINE = "#ffffff";

/** Degrees of slant on the shine sweep. */
const SHINE_ANGLE_DEGREES = 20;
const SHINE_TAN = Math.tan((SHINE_ANGLE_DEGREES * Math.PI) / 180);

/** Horizontal offset of the sweep at a given distance down its band. */
export function shineOffsetAt(y: number): number {
  return y * SHINE_TAN;
}

export const SLOT_EMITTERS = {
  /** Parabolic arcs with horizontal spread, two tone gold, fading only at the end. */
  coinBurst: (intensity = 1): EmitterConfig => ({
    count: Math.round(10 * intensity),
    gravity: 520,
    spread: Math.PI * 0.7,
    direction: -Math.PI / 2,
    lifetimeMs: [650, 1_050],
    speed: [90, 190],
    size: [2, 4],
    draw: (target: DrawTarget, p: Particle, age: number) => {
      // Full brightness until the last fifth, then out.
      const alpha = age < 0.8 ? 1 : Math.max(0.05, 1 - (age - 0.8) / 0.2);
      const size = Math.max(1, Math.round(p.size));
      target.fillRect(Math.round(p.x), Math.round(p.y), size, size, p.seed < 0.5 ? COIN_BRIGHT : COIN_DEEP, alpha);
    },
  }),
} as const;

export interface PayoffPlan {
  /** Number of flash rings to stack on the win. */
  rings: number;
  coinIntensity: number;
  shine: boolean;
  reverseBulbs: boolean;
}

/** How loud the payoff is, by symbol rarity and combination. */
export function TIER_PAYOFF(result: { tier: Tier; combo: Combo }): PayoffPlan {
  const tierWeight = result.tier === "rare" ? 3 : result.tier === "uncommon" ? 2 : 1;
  const comboWeight = result.combo === "threeOfAKind" ? 3 : result.combo === "pair" ? 2 : 1;
  const score = tierWeight * comboWeight;
  return {
    rings: Math.max(1, Math.min(3, Math.round(score / 2))),
    coinIntensity: score,
    shine: comboWeight > 1 || tierWeight === 3,
    reverseBulbs: comboWeight > 1,
  };
}

interface Ring {
  x: number;
  y: number;
  /** Visible on the first frame: an impulse should not arrive a frame late. */
  startRadius: number;
  /** Final radius in logical pixels. */
  maxRadius: number;
  /** Stroke width at birth, shrinking as the radius grows. */
  startStroke: number;
  lifeMs: number;
  ageMs: number;
}

interface Sweep {
  bounds: { x: number; y: number; width: number; height: number };
  /** Band width across the slant. */
  band: number;
  lifeMs: number;
  ageMs: number;
}

const RING_LIFE_MS = 420;
const SWEEP_LIFE_MS = 620;

export class SlotVfx {
  private rings: Ring[] = [];
  private sweeps: Sweep[] = [];

  constructor(private readonly emitter: ParticleEmitter) {}

  get activeRings(): number {
    return this.rings.length;
  }

  /** Expanding stroked circle. Radius grows, stroke thins, alpha falls with radius. */
  flashRing(x: number, y: number, intensity = 1): void {
    this.rings.push({ x, y, startRadius: 4, maxRadius: 26 * intensity, startStroke: 3 + intensity, lifeMs: RING_LIFE_MS, ageMs: 0 });
  }

  coinBurst(x: number, y: number, intensity = 1): void {
    this.emitter.emit(x, y, SLOT_EMITTERS.coinBurst(intensity));
  }

  shineSweep(bounds: { x: number; y: number; width: number; height: number }): void {
    this.sweeps.push({ bounds, band: 16, lifeMs: SWEEP_LIFE_MS, ageMs: 0 });
  }

  advance(deltaMs: number): void {
    if (!(deltaMs > 0)) return;
    this.rings = this.rings.filter((r) => (r.ageMs += deltaMs) < r.lifeMs);
    this.sweeps = this.sweeps.filter((s) => (s.ageMs += deltaMs) < s.lifeMs);
    this.emitter.update(deltaMs);
  }

  draw(target: DrawTarget): void {
    for (const ring of this.rings) this.drawRing(target, ring);
    for (const sweep of this.sweeps) this.drawSweep(target, sweep);
    this.emitter.draw(target);
  }

  clear(): void {
    this.rings = [];
    this.sweeps = [];
    this.emitter.clear();
  }

  private drawRing(target: DrawTarget, ring: Ring): void {
    const t = ring.ageMs / ring.lifeMs;
    const radius = ring.startRadius + (ring.maxRadius - ring.startRadius) * t;
    // Stroke thins and alpha falls as the radius grows, so the ring reads as
    // one impulse spreading out rather than a growing disc.
    const stroke = Math.max(1, Math.round(ring.startStroke * (1 - t)));
    const alpha = Math.max(0.05, 1 - t);
    const steps = Math.max(12, Math.round(radius * 2));
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const px = ring.x + Math.cos(angle) * radius;
      const py = ring.y + Math.sin(angle) * radius;
      target.fillRect(Math.round(px - stroke / 2), Math.round(py - stroke / 2), stroke, stroke, RING, alpha);
    }
  }

  private drawSweep(target: DrawTarget, sweep: Sweep): void {
    const b = sweep.bounds;
    const t = sweep.ageMs / sweep.lifeMs;
    const slantSpan = shineOffsetAt(b.height);
    // Travel from fully off the left edge to fully off the right edge.
    const head = b.x - sweep.band - slantSpan + t * (b.width + sweep.band * 2 + slantSpan * 2);
    for (let row = 0; row < b.height; row++) {
      const y = b.y + row;
      const left = head + shineOffsetAt(b.height - row);
      const clippedLeft = Math.max(b.x, left);
      const clippedRight = Math.min(b.x + b.width, left + sweep.band);
      const width = clippedRight - clippedLeft;
      if (width <= 0) continue;
      target.fillRect(clippedLeft, y, width, 1, SHINE, 0.16);
    }
  }
}
