// Combatant construction and grid combat primitives shared by modes.

import type { StatBlock } from "@/config/round";
import type { Tier } from "@/config/roster";
import { FACING, facingToward, type Facing } from "./events";
import { applyPct, idiv } from "./intmath";
import type { Combo, Pull } from "./reels";
import type { Rng } from "./rng";

export interface Combatant {
  entrantId: string;
  characterId: string;
  tier: Tier;
  stats: StatBlock;
  modifierId: string;
  statRollPct: number;
  combo: Combo;
  bonusPct: number;
}

export function buildCombatant(entrantId: string, pull: Pull, base: StatBlock): Combatant {
  const m = pull.modifier;
  const flat = pull.statRollPct + pull.bonusPct;
  return {
    entrantId,
    characterId: pull.characterId,
    tier: pull.characterTier,
    stats: {
      hp: Math.max(1, applyPct(base.hp, m.hpPct + flat)),
      atk: applyPct(base.atk, m.atkPct + flat),
      def: applyPct(base.def, m.defPct + flat),
      spd: base.spd + m.spd,
    },
    modifierId: m.id,
    statRollPct: pull.statRollPct,
    combo: pull.combo,
    bonusPct: pull.bonusPct,
  };
}

export interface Fighter {
  c: Combatant;
  x: number;
  y: number;
  hp: number;
  facing: Facing;
  alive: boolean;
  /** Position in turn order. */
  order: number;
}

export interface Arena {
  width: number;
  height: number;
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const tileKey = (x: number, y: number): number => y * 65_536 + x;

/** Shuffled turn order, each fighter on a distinct tile. */
export function placeFighters(rng: Rng, combatants: readonly Combatant[], arena: Arena): Fighter[] {
  const order = shuffle(rng, combatants);
  const tileCount = arena.width * arena.height;
  const tiles = Array.from({ length: tileCount }, (_, i) => i);
  return order.map((c, i) => {
    const j = i + rng.nextInt(tileCount - i);
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    const tile = tiles[i];
    const x = tile % arena.width;
    const y = idiv(tile, arena.width);
    return { c, x, y, hp: c.stats.hp, facing: FACING.down, alive: true, order: i };
  });
}

export const manhattan = (a: Fighter, b: Fighter): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Closest living opponent. Ties go to the earlier turn order. */
export function nearestEnemy(self: Fighter, fighters: readonly Fighter[]): Fighter | undefined {
  let best: Fighter | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const f of fighters) {
    if (f === self || !f.alive) continue;
    const d = manhattan(self, f);
    if (d < bestDist || (d === bestDist && best !== undefined && f.order < best.order)) {
      best = f;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Moves one tile toward the target along the dominant axis, falling back to
 * the other axis when blocked. Updates position, facing and the occupancy
 * set. Returns false when no step was possible.
 */
export function stepToward(self: Fighter, target: Fighter, occupied: Set<number>, arena: Arena): boolean {
  const dx = target.x - self.x;
  const dy = target.y - self.y;
  const horizontal: [number, number] = [Math.sign(dx), 0];
  const vertical: [number, number] = [0, Math.sign(dy)];
  const primary = Math.abs(dx) >= Math.abs(dy) ? horizontal : vertical;
  const secondary = primary === horizontal ? vertical : horizontal;
  for (const [sx, sy] of [primary, secondary]) {
    if (sx === 0 && sy === 0) continue;
    const nx = self.x + sx;
    const ny = self.y + sy;
    if (nx < 0 || ny < 0 || nx >= arena.width || ny >= arena.height) continue;
    if (occupied.has(tileKey(nx, ny))) continue;
    occupied.delete(tileKey(self.x, self.y));
    self.x = nx;
    self.y = ny;
    self.facing = facingToward(sx, sy);
    occupied.add(tileKey(nx, ny));
    return true;
  }
  return false;
}

/** atk scaled by a random percentage in [100 - variance, 100 + variance], minus def, floored at minDamage. */
export function rollDamage(rng: Rng, atk: number, def: number, variancePct: number, minDamage: number): number {
  const pctRoll = 100 - variancePct + rng.nextInt(2 * variancePct + 1);
  const raw = idiv(atk * pctRoll, 100);
  return Math.max(minDamage, raw - def);
}
