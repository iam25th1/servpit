// Playback timeline. One instance owns the round clock; the render loop
// feeds it elapsed milliseconds and every other system reads state from it
// or subscribes to tick batches. It never schedules time itself.
//
// Tick model: tick 0 (spawns) is applied at time 0. For T >= 1, tick T owns
// the window [(T - 1) * tickMs, T * tickMs). During that window actors walk
// their tick T move path with linear easing, then at the window's end the
// whole tick T batch is applied at once (hp, deaths, facing, listeners).
// So a hit lands when the walk that produced it completes, and the first
// window is not dead time. durationMs = lastTick * tickMs.

import type { Tier } from "@/config/roster";
import type { Combatant } from "@/engine/combat";
import type { Facing, RoundEvent } from "@/engine/events";

export interface TimelineOptions {
  /** Milliseconds per tick. Default 200 (a 37 tick round plays in about 7.5 s). */
  tickMs?: number;
}

export interface ActorState {
  id: string;
  characterId: string;
  tier: Tier;
  /** Interpolated tile position for the current time. */
  x: number;
  y: number;
  /** Tile position after the last applied tick. */
  tileX: number;
  tileY: number;
  facing: Facing;
  hp: number;
  maxHp: number;
  alive: boolean;
  moving: boolean;
  diedAtTick: number | null;
}

export interface TickBatch {
  t: number;
  events: readonly RoundEvent[];
}

export type BatchListener = (batch: TickBatch, silent: boolean) => void;

interface PathPoint {
  x: number;
  y: number;
  facing: Facing;
}

interface Internal {
  id: string;
  characterId: string;
  tier: Tier;
  tileX: number;
  tileY: number;
  facing: Facing;
  hp: number;
  maxHp: number;
  alive: boolean;
  diedAtTick: number | null;
  /** Walk path for the pending tick's window, starting at the current tile. */
  path: PathPoint[];
}

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

export class Timeline {
  readonly tickMs: number;
  readonly lastTick: number;
  readonly durationMs: number;
  playing = false;

  private readonly batches: RoundEvent[][] = [];
  private readonly characters: readonly Combatant[];
  private readonly state = new Map<string, Internal>();
  private readonly order: string[];
  private readonly listeners: BatchListener[] = [];
  private time = 0;
  private applied = 0;

  constructor(round: { log: readonly RoundEvent[]; characters: readonly Combatant[] }, options: TimelineOptions = {}) {
    const tickMs = options.tickMs ?? 200;
    if (!Number.isFinite(tickMs) || tickMs <= 0) throw new RangeError(`tickMs must be a positive number, got ${tickMs}`);
    this.tickMs = tickMs;
    this.characters = round.characters;
    this.order = round.characters.map((c) => c.entrantId);
    let last = 0;
    for (const ev of round.log) {
      (this.batches[ev.t] ??= []).push(ev);
      last = Math.max(last, ev.t);
    }
    this.lastTick = last;
    this.durationMs = last * tickMs;
    this.reset();
  }

  get timeMs(): number {
    return this.time;
  }

  /** Number of the last applied tick. */
  get tick(): number {
    return this.applied;
  }

  /** Position inside the pending tick's window, 0 to 1. */
  get progress(): number {
    if (this.applied >= this.lastTick) return 0;
    const p = (this.time - this.applied * this.tickMs) / this.tickMs;
    return Math.min(1, Math.max(0, p));
  }

  get finished(): boolean {
    return this.time >= this.durationMs;
  }

  onBatch(listener: BatchListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  play(): void {
    if (this.finished) this.seek(0);
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  restart(): void {
    this.seek(0);
    this.playing = true;
  }

  /** Rebuilds state from tick 0 up to the tick that owns ms. Listeners are told silent = true. */
  seek(ms: number): void {
    const target = Math.min(this.durationMs, Math.max(0, Number.isFinite(ms) ? ms : 0));
    this.reset();
    const ticks = Math.min(this.lastTick, Math.floor(target / this.tickMs));
    for (let t = 1; t <= ticks; t++) this.apply(t, true);
    this.time = target;
    this.preparePending();
    if (this.finished) this.playing = false;
  }

  /** Advances the clock while playing, applying every tick whose window ended. */
  advance(deltaMs: number): void {
    if (!this.playing || !(deltaMs > 0)) return;
    const newTime = Math.min(this.durationMs, this.time + deltaMs);
    const ticks = Math.min(this.lastTick, Math.floor(newTime / this.tickMs));
    while (this.applied < ticks) this.apply(this.applied + 1, false);
    this.time = newTime;
    this.preparePending();
    if (this.finished) this.playing = false;
  }

  actors(): ActorState[] {
    return this.order.map((id) => this.view(this.state.get(id)!));
  }

  actor(id: string): ActorState {
    const s = this.state.get(id);
    if (!s) throw new Error(`unknown actor ${id}`);
    return this.view(s);
  }

  private reset(): void {
    this.state.clear();
    for (const c of this.characters) {
      this.state.set(c.entrantId, {
        id: c.entrantId,
        characterId: c.characterId,
        tier: c.tier,
        tileX: 0,
        tileY: 0,
        facing: 0,
        hp: c.stats.hp,
        maxHp: c.stats.hp,
        alive: true,
        diedAtTick: null,
        path: [],
      });
    }
    this.time = 0;
    this.playing = false;
    this.apply(0, true);
    this.preparePending();
  }

  private apply(t: number, silent: boolean): void {
    const events = this.batches[t] ?? [];
    for (const ev of events) {
      const s = this.state.get(ev.actor);
      if (!s) continue;
      s.facing = ev.facing;
      switch (ev.type) {
        case "spawn":
          s.tileX = ev.x ?? 0;
          s.tileY = ev.y ?? 0;
          s.maxHp = ev.value;
          s.hp = ev.value;
          break;
        case "move":
          s.tileX = ev.x ?? s.tileX;
          s.tileY = ev.y ?? s.tileY;
          break;
        case "hit":
        case "storm":
          if (ev.hp !== undefined) s.hp = ev.hp;
          break;
        case "death":
          s.alive = false;
          s.hp = 0;
          s.diedAtTick = t;
          break;
        default:
          break;
      }
    }
    this.applied = t;
    const batch: TickBatch = { t, events };
    for (const l of [...this.listeners]) l(batch, silent);
  }

  private preparePending(): void {
    for (const s of this.state.values()) s.path = [{ x: s.tileX, y: s.tileY, facing: s.facing }];
    const pending = this.applied + 1;
    if (pending > this.lastTick) return;
    for (const ev of this.batches[pending] ?? []) {
      if (ev.type !== "move" || ev.x === undefined || ev.y === undefined) continue;
      this.state.get(ev.actor)?.path.push({ x: ev.x, y: ev.y, facing: ev.facing });
    }
  }

  private view(s: Internal): ActorState {
    const p = this.progress;
    const segments = s.path.length - 1;
    let x = s.tileX;
    let y = s.tileY;
    let facing = s.facing;
    let moving = false;
    if (segments >= 1 && p > 0 && p < 1) {
      const along = p * segments;
      const i = Math.min(Math.floor(along), segments - 1);
      const f = along - i;
      x = lerp(s.path[i].x, s.path[i + 1].x, f);
      y = lerp(s.path[i].y, s.path[i + 1].y, f);
      facing = s.path[i + 1].facing;
      moving = true;
    }
    return {
      id: s.id,
      characterId: s.characterId,
      tier: s.tier,
      x,
      y,
      tileX: s.tileX,
      tileY: s.tileY,
      facing,
      hp: s.hp,
      maxHp: s.maxHp,
      alive: s.alive,
      moving,
      diedAtTick: s.diedAtTick,
    };
  }
}
