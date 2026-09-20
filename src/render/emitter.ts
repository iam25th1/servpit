// One config driven particle emitter. Coins, sparks, smoke and confetti are
// presets of the same system, not separate effects. Randomness is injected
// (a seeded unit float source) so a replay produces the same particles, and
// time only arrives through update(deltaMs) from the shared loop.

import type { DrawTarget } from "./draw";

export interface Particle {
  x: number;
  y: number;
  /** Pixels per second. */
  vx: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
  size: number;
  /** Stable 0 to 1 value for per particle variety. */
  seed: number;
}

export interface EmitterConfig {
  count: number;
  /** Pixels per second squared, positive is down the screen. */
  gravity: number;
  /** Cone width in radians around direction. */
  spread: number;
  /** Radians, 0 points right, positive turns toward the bottom of the screen. */
  direction: number;
  lifetimeMs: readonly [number, number];
  /** Pixels per second. */
  speed: readonly [number, number];
  size: readonly [number, number];
  /** age is the particle's life fraction, 0 at birth approaching 1 at death. */
  draw: (target: DrawTarget, particle: Particle, age: number) => void;
}

export interface EmitterOptions {
  /** Hard cap on live particles; the oldest are dropped first. Default 1500. */
  maxParticles?: number;
}

interface Live {
  p: Particle;
  config: EmitterConfig;
}

const between = (random: () => number, [min, max]: readonly [number, number]): number => min + (max - min) * random();

export class ParticleEmitter {
  private live: Live[] = [];
  private readonly maxParticles: number;

  constructor(private readonly random: () => number, options: EmitterOptions = {}) {
    this.maxParticles = options.maxParticles ?? 1500;
  }

  get count(): number {
    return this.live.length;
  }

  particles(): Particle[] {
    return this.live.map((l) => l.p);
  }

  emit(x: number, y: number, config: EmitterConfig): void {
    for (let i = 0; i < config.count; i++) {
      const angle = config.direction + (this.random() - 0.5) * config.spread;
      const speed = between(this.random, config.speed);
      this.live.push({
        p: {
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          ageMs: 0,
          lifeMs: between(this.random, config.lifetimeMs),
          size: between(this.random, config.size),
          seed: this.random(),
        },
        config,
      });
    }
    if (this.live.length > this.maxParticles) this.live.splice(0, this.live.length - this.maxParticles);
  }

  update(deltaMs: number): void {
    if (!(deltaMs > 0)) return;
    const dt = deltaMs / 1000;
    this.live = this.live.filter(({ p, config }) => {
      p.ageMs += deltaMs;
      if (p.ageMs >= p.lifeMs) return false;
      p.vy += config.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      return true;
    });
  }

  draw(target: DrawTarget): void {
    for (const { p, config } of this.live) config.draw(target, p, p.ageMs / p.lifeMs);
  }

  clear(): void {
    this.live = [];
  }
}

// Presets. Flat colours only, nothing in the purple range.
const COIN = "#ffc107";
const SPARK_HOT = "#fff3b0";
const SPARK_COOL = "#ffb300";
const SMOKE = "#8a8f88";
const CONFETTI = ["#e53935", "#43a047", "#1e88e5", "#fdd835", "#fb8c00"];

const square = (target: DrawTarget, p: Particle, color: string, alpha: number, size = p.size): void => {
  target.fillRect(Math.round(p.x), Math.round(p.y), Math.max(1, Math.round(size)), Math.max(1, Math.round(size)), color, alpha);
};

const fadeLate = (age: number): number => (age < 0.6 ? 1 : Math.max(0.05, 1 - (age - 0.6) / 0.4));

export const PRESETS = {
  coins: (intensity = 1): EmitterConfig => ({
    count: Math.round(8 * intensity),
    gravity: 400,
    spread: Math.PI * 0.8,
    direction: -Math.PI / 2,
    lifetimeMs: [500, 900],
    speed: [60, 140],
    size: [2, 3],
    draw: (target, p, age) => square(target, p, COIN, fadeLate(age), p.seed < 0.5 && age % 0.2 < 0.1 ? p.size - 1 : p.size),
  }),
  sparks: (intensity = 1): EmitterConfig => ({
    count: Math.round(6 * intensity),
    gravity: 0,
    spread: Math.PI * 2,
    direction: 0,
    lifetimeMs: [120, 260],
    speed: [80, 200],
    size: [1, 2],
    draw: (target, p, age) => square(target, p, age < 0.4 ? SPARK_HOT : SPARK_COOL, Math.max(0.05, 1 - age)),
  }),
  smoke: (intensity = 1): EmitterConfig => ({
    count: Math.round(5 * intensity),
    gravity: -30,
    spread: Math.PI / 2,
    direction: -Math.PI / 2,
    lifetimeMs: [500, 900],
    speed: [10, 30],
    size: [2, 4],
    draw: (target, p, age) => square(target, p, SMOKE, Math.max(0.05, 0.5 * (1 - age)), p.size + age * 3),
  }),
  confetti: (intensity = 1): EmitterConfig => ({
    count: Math.round(12 * intensity),
    gravity: 250,
    spread: Math.PI * 0.9,
    direction: -Math.PI / 2,
    lifetimeMs: [700, 1200],
    speed: [60, 180],
    size: [2, 3],
    draw: (target, p, age) => square(target, p, CONFETTI[Math.floor(p.seed * CONFETTI.length) % CONFETTI.length], fadeLate(age)),
  }),
} as const;
