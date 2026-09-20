// Impact juice. Everything here is sprite local (white flash, offset away
// from the attacker, scale punch, corpse fade) or spawns effects at a point
// (impact sheets, particles). Nothing moves the camera, nothing blurs.
//
// Hitstop freezes actors only, for a few render frames, and fires only on
// death events and the round's final blow, capped at one per tick. Ordinary
// hits never freeze: 23 of them can share a tick.

import { ticksToMs } from "@/config/playback";
import type { Tier } from "@/config/roster";
import type { RoundEvent } from "@/engine/events";
import type { ActorFx } from "./arena";
import type { AssetStore, FxSprites } from "./assets";
import type { DrawTarget } from "./draw";
import { PRESETS, type ParticleEmitter } from "./emitter";
import type { ActorState, TickBatch } from "./timeline";

export interface TierImpact {
  /** FX sheet id from the manifest fx section. */
  sheet: string;
  sheetScale: number;
  /** Spark preset intensity. */
  sparks: number;
}

export interface JuiceConfig {
  /** Milliseconds actors stay frozen. Only deaths and the final blow trigger it. */
  hitstopMs: { death: number; finalBlow: number };
  /** Milliseconds the victim is drawn as a white silhouette. */
  flashMs: number;
  /** Victim offset away from the attacker on contact, easing back over knockbackMs. */
  knockbackPx: number;
  knockbackMs: number;
  /** Attacker sprite local scale on contact, settling over punchMs. */
  punchScale: number;
  punchMs: number;
  /** Milliseconds the attacker holds the attack pose. */
  attackPoseMs: number;
  /** Milliseconds over which a corpse fades from 1 to corpseAlpha. */
  deadFadeMs: number;
  corpseAlpha: number;
  /** Milliseconds per FX sheet frame. */
  sheetFrameMs: number;
  impactByTier: Record<Tier, TierImpact>;
  deathSheet: string;
  killSheet: string;
}

/**
 * Every duration here is a fraction of a tick, in milliseconds.
 *
 * They were render frame counts until phase 9. A frame is not a unit of
 * time: it is 16.7 ms on a 60 Hz display and 8.3 ms on a 120 Hz one, so a
 * five frame hitstop held for 83 ms on one machine and 42 ms on another.
 * Every impact ran at half length on a fast display and nothing said so.
 *
 * The fractions are unchanged, and ticksToMs keeps the rounding to whole
 * 60 Hz frames that the previous build shipped, so the look at 60 Hz is
 * identical and only the faster displays change.
 */
export const DEFAULT_JUICE: JuiceConfig = {
  hitstopMs: { death: ticksToMs(1 / 4), finalBlow: ticksToMs(5 / 12) },
  flashMs: ticksToMs(1 / 6),
  knockbackPx: 3,
  knockbackMs: ticksToMs(1 / 3),
  punchScale: 1.15,
  punchMs: ticksToMs(5 / 12),
  attackPoseMs: ticksToMs(1 / 2),
  deadFadeMs: ticksToMs(10 / 3),
  corpseAlpha: 0.35,
  // Absolute, deliberately. This is the artist's own frame rate for the
  // sheet; slowing it because the fight slowed plays the artwork back in
  // slow motion.
  sheetFrameMs: 50,
  impactByTier: {
    common: { sheet: "Cut", sheetScale: 1, sparks: 1 },
    uncommon: { sheet: "CutDouble", sheetScale: 1.15, sparks: 2 },
    rare: { sheet: "CircularSlash", sheetScale: 1.5, sparks: 3 },
  },
  deathSheet: "Smoke",
  killSheet: "Explosion",
};

/** Milliseconds remaining on each effect, counting down. */
interface ActorTimers {
  flash: number;
  knock: number;
  knockDirX: number;
  knockDirY: number;
  punch: number;
  attackPose: number;
  /** Milliseconds since the death started fading, or null while alive. */
  dying: number | null;
}

interface SheetInstance {
  id: string;
  sprites: FxSprites;
  x: number;
  y: number;
  scale: number;
  elapsedMs: number;
}

export interface ActiveSheet {
  id: string;
  x: number;
  y: number;
  frame: number;
}

type Point = { x: number; y: number };
type TileToPixel = (x: number, y: number) => { px: number; py: number };
type Lookup = (id: string) => ActorState | undefined;

/**
 * Milliseconds below which a timer is finished. A duration divided into
 * equal deltas does not land on zero in binary floating point: ten steps of
 * 1000/60 leave about 1e-14 ms on the clock, which is enough to hold a pose
 * for one more frame than it should.
 */
const EPSILON_MS = 1e-9;

/** Take deltaMs off a countdown, snapping float dust to a finished timer. */
function drain(remaining: number, deltaMs: number): number {
  const next = remaining - deltaMs;
  return next > EPSILON_MS ? next : 0;
}

const freshTimers = (): ActorTimers => ({ flash: 0, knock: 0, knockDirX: 0, knockDirY: 0, punch: 0, attackPose: 0, dying: null });

export class Juice {
  private readonly timers = new Map<string, ActorTimers>();
  private sheets: SheetInstance[] = [];
  /** Milliseconds of freeze left. */
  private hitstop = 0;

  constructor(
    private readonly store: AssetStore,
    private readonly emitter: ParticleEmitter,
    private readonly tileToPixel: TileToPixel,
    private readonly config: JuiceConfig = DEFAULT_JUICE,
  ) {}

  /** True while actors are frozen. The loop skips the timeline but still advances effects. */
  get frozen(): boolean {
    return this.hitstop > 0;
  }

  onBatch(batch: TickBatch, silent: boolean, lookup: Lookup): void {
    if (silent) return;
    const c = this.config;
    const deaths = new Set(batch.events.filter((ev) => ev.type === "death").map((ev) => ev.actor));
    let stop = 0;
    for (const ev of batch.events) {
      switch (ev.type) {
        case "hit":
          this.onHit(ev, lookup, deaths);
          break;
        case "storm":
          this.timersFor(ev.actor).flash = c.flashMs;
          break;
        case "death": {
          const victim = lookup(ev.actor);
          if (victim) {
            const at = this.centre(victim);
            this.spawnSheet(c.deathSheet, at, 1);
            this.emitter.emit(at.x, at.y, PRESETS.smoke(1));
          }
          this.timersFor(ev.actor).dying = 0;
          stop = Math.max(stop, c.hitstopMs.death);
          break;
        }
        case "win": {
          const winner = lookup(ev.actor);
          if (winner) {
            const at = this.centre(winner);
            this.emitter.emit(at.x, at.y, PRESETS.confetti(2));
            this.emitter.emit(at.x, at.y, PRESETS.coins(2));
          }
          stop = Math.max(stop, c.hitstopMs.finalBlow);
          break;
        }
        default:
          break;
      }
    }
    this.hitstop = stop;
  }

  /**
   * Advance everything by wall time, on the same delta the Timeline is given.
   * This is the only clock the juice layer has.
   *
   * Effects run first and run unconditionally, because hitstop freezes the
   * actors and not the world: sparks and smoke keep moving while the fight
   * holds still. Actor timers then advance only when the freeze is over, so
   * the frame that empties the hitstop leaves them untouched, exactly as the
   * frame counted version did.
   */
  advance(deltaMs: number): void {
    if (!(deltaMs > 0)) return;
    this.sheets = this.sheets.filter((s) => {
      s.elapsedMs += deltaMs;
      return Math.floor(s.elapsedMs / this.config.sheetFrameMs) < s.sprites.frames.length;
    });
    this.emitter.update(deltaMs);

    // A delta longer than the freeze spends what the freeze is owed and
    // carries the rest into the actor timers. Dropping the remainder would
    // make the layer sensitive to how big a step it is handed, which is the
    // fault this whole conversion exists to remove.
    let remaining = deltaMs;
    if (this.hitstop > 0) {
      const spent = Math.min(this.hitstop, remaining);
      this.hitstop = drain(this.hitstop, spent);
      remaining -= spent;
      if (remaining <= EPSILON_MS) return;
    }
    for (const [id, t] of this.timers) {
      t.flash = drain(t.flash, remaining);
      t.knock = drain(t.knock, remaining);
      t.punch = drain(t.punch, remaining);
      t.attackPose = drain(t.attackPose, remaining);
      if (t.dying !== null) t.dying += remaining;
      if (t.flash === 0 && t.knock === 0 && t.punch === 0 && t.attackPose === 0 && t.dying === null) this.timers.delete(id);
    }
  }

  /** Per actor sprite local modifiers for this frame. Pass the current actors so seeked in corpses get corpse alpha. */
  actorFx(actors?: readonly ActorState[]): Map<string, ActorFx> {
    const c = this.config;
    const out = new Map<string, ActorFx>();
    for (const [id, t] of this.timers) {
      const knockT = t.knock / c.knockbackMs;
      out.set(id, {
        offsetX: t.knock > 0 ? t.knockDirX * c.knockbackPx * knockT : 0,
        offsetY: t.knock > 0 ? t.knockDirY * c.knockbackPx * knockT : 0,
        scale: t.punch > 0 ? 1 + (c.punchScale - 1) * (t.punch / c.punchMs) : 1,
        white: t.flash > 0,
        alpha: t.dying === null ? 1 : Math.max(c.corpseAlpha, 1 - (t.dying / c.deadFadeMs) * (1 - c.corpseAlpha)),
        attacking: t.attackPose > 0,
      });
    }
    if (actors) {
      for (const a of actors) {
        if (!a.alive && !out.has(a.id)) {
          out.set(a.id, { offsetX: 0, offsetY: 0, scale: 1, white: false, alpha: c.corpseAlpha, attacking: false });
        }
      }
    }
    return out;
  }

  activeSheets(): ActiveSheet[] {
    return this.sheets.map((s) => ({ id: s.id, x: s.x, y: s.y, frame: Math.floor(s.elapsedMs / this.config.sheetFrameMs) }));
  }

  drawEffects(target: DrawTarget): void {
    for (const s of this.sheets) {
      const frame = s.sprites.frames[Math.floor(s.elapsedMs / this.config.sheetFrameMs)];
      if (!frame) continue;
      target.drawSlice(frame, s.x - frame.sw / 2, s.y - frame.sh / 2, { scale: s.scale });
    }
    this.emitter.draw(target);
  }

  reset(): void {
    this.timers.clear();
    this.sheets = [];
    this.hitstop = 0;
    this.emitter.clear();
  }

  private onHit(ev: RoundEvent, lookup: Lookup, deaths: ReadonlySet<string>): void {
    const c = this.config;
    const victim = lookup(ev.actor);
    const attacker = ev.target ? lookup(ev.target) : undefined;
    if (!victim || !attacker) return;

    const dx = victim.x - attacker.x;
    const dy = victim.y - attacker.y;
    const len = Math.hypot(dx, dy);
    const v = this.timersFor(victim.id);
    v.flash = c.flashMs;
    v.knock = c.knockbackMs;
    v.knockDirX = len > 0 ? dx / len : 0;
    v.knockDirY = len > 0 ? dy / len : 0;

    const a = this.timersFor(attacker.id);
    a.punch = c.punchMs;
    a.attackPose = c.attackPoseMs;

    const from = this.centre(attacker);
    const to = this.centre(victim);
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const impact = c.impactByTier[attacker.tier];
    this.spawnSheet(impact.sheet, mid, impact.sheetScale);
    this.emitter.emit(mid.x, mid.y, PRESETS.sparks(impact.sparks));
    if (deaths.has(victim.id)) {
      this.spawnSheet(c.killSheet, mid, 1);
      this.emitter.emit(mid.x, mid.y, PRESETS.sparks(2));
    }
  }

  private centre(actor: ActorState): Point {
    const { px, py } = this.tileToPixel(actor.x + 0.5, actor.y + 0.5);
    return { x: px, y: py };
  }

  private spawnSheet(id: string, at: Point, scale: number): void {
    const sprites = this.store.fx.get(id);
    if (!sprites) throw new Error(`fx sheet ${id} is not loaded`);
    this.sheets.push({ id, sprites, x: at.x, y: at.y, scale, elapsedMs: 0 });
  }

  private timersFor(id: string): ActorTimers {
    let t = this.timers.get(id);
    if (!t) {
      t = freshTimers();
      this.timers.set(id, t);
    }
    return t;
  }
}
