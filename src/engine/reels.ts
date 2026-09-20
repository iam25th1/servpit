// Three reel weighted draw over the roster strip.

import { TIERS, type RosterEntry, type Tier } from "@/config/roster";
import type { Modifier, ReelConfig } from "@/config/reels";
import type { Rng } from "./rng";
import { assertInt, idiv } from "./intmath";

export interface ReelStrip {
  readonly symbols: readonly string[];
  readonly weights: readonly number[];
  readonly cumulative: readonly number[];
  readonly total: number;
}

export type Combo = "none" | "pair" | "threeOfAKind";

export interface Pull {
  readonly symbols: readonly [string, string, string];
  readonly characterId: string;
  readonly characterTier: Tier;
  readonly modifier: Modifier;
  readonly statRollPct: number;
  readonly combo: Combo;
  readonly bonusPct: number;
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

function tierCounts(roster: readonly RosterEntry[]): Record<Tier, number> {
  const counts: Record<Tier, number> = { common: 0, uncommon: 0, rare: 0 };
  for (const e of roster) counts[e.tier]++;
  return counts;
}

/** Integer strip where each tier's members share that tier's weight evenly. */
export function buildStrip(roster: readonly RosterEntry[], tierWeights: Record<Tier, number>): ReelStrip {
  const counts = tierCounts(roster);
  let scale = 1;
  for (const tier of TIERS) if (counts[tier] > 0) scale = lcm(scale, counts[tier]);
  const symbols = roster.map((e) => e.id);
  const weights = roster.map((e) => tierWeights[e.tier] * (scale / counts[e.tier]));
  const cumulative: number[] = [];
  let total = 0;
  for (const w of weights) {
    total += w;
    cumulative.push(total);
  }
  if (total < 1) throw new RangeError("tierWeights: strip has no weight");
  return { symbols, weights, cumulative, total };
}

/** Index into the strip, drawn proportionally to weight. */
export function spinReel(rng: Rng, strip: ReelStrip): number {
  const r = rng.nextInt(strip.total);
  for (let i = 0; i < strip.cumulative.length; i++) {
    if (r < strip.cumulative[i]) return i;
  }
  throw new Error("unreachable: draw exceeded strip total");
}

export function classifyCombo(symbols: readonly [string, string, string]): Combo {
  const [a, b, c] = symbols;
  if (a === b && b === c) return "threeOfAKind";
  if (a === b || b === c || a === c) return "pair";
  return "none";
}

export function pull(rng: Rng, roster: readonly RosterEntry[], config: ReelConfig): Pull {
  const strip = buildStrip(roster, config.tierWeights);
  const idx = [spinReel(rng, strip), spinReel(rng, strip), spinReel(rng, strip)] as const;
  const symbols = [strip.symbols[idx[0]], strip.symbols[idx[1]], strip.symbols[idx[2]]] as const;
  const character = roster[idx[0]];

  const face2 = roster[idx[1]];
  const members2 = roster.filter((e) => e.tier === face2.tier);
  const table = config.modifiers[face2.tier];
  const modifier = { ...table[members2.indexOf(face2) % table.length] };

  const face3 = roster[idx[2]];
  const members3 = roster.filter((e) => e.tier === face3.tier);
  const range = config.statRoll[face3.tier];
  const span = range.max - range.min;
  const pos3 = members3.indexOf(face3);
  const statRollPct = range.min + (members3.length > 1 ? idiv(pos3 * span, members3.length - 1) : 0);

  const combo = classifyCombo(symbols);
  const bonusPct = combo === "none" ? 0 : config.combos[combo];

  return { symbols, characterId: character.id, characterTier: character.tier, modifier, statRollPct, combo, bonusPct };
}

const PCT_MAX = 1000;

export function validateReelConfig(config: ReelConfig, roster: readonly RosterEntry[]): void {
  if (roster.length < 1) throw new RangeError("roster must not be empty");
  if (new Set(roster.map((e) => e.id)).size !== roster.length) throw new RangeError("roster ids must be unique");

  let weightSum = 0;
  for (const tier of TIERS) {
    assertInt(config.tierWeights[tier], `tierWeights.${tier}`, 0, 1_000_000);
    weightSum += config.tierWeights[tier];
  }
  if (weightSum < 1) throw new RangeError("tierWeights must not all be zero");

  for (const tier of TIERS) {
    const table = config.modifiers[tier];
    if (!Array.isArray(table) || table.length < 1) throw new RangeError(`modifiers.${tier} must be a non empty array`);
    table.forEach((m, i) => {
      if (typeof m.id !== "string" || m.id.length < 1) throw new RangeError(`modifiers.${tier}[${i}].id must be a non empty string`);
      assertInt(m.hpPct, `modifiers.${tier}[${i}].hpPct`, -100, PCT_MAX);
      assertInt(m.atkPct, `modifiers.${tier}[${i}].atkPct`, -100, PCT_MAX);
      assertInt(m.defPct, `modifiers.${tier}[${i}].defPct`, -100, PCT_MAX);
      assertInt(m.spd, `modifiers.${tier}[${i}].spd`, 0, 10);
    });
    const range = config.statRoll[tier];
    assertInt(range.min, `statRoll.${tier}.min`, 0, PCT_MAX);
    assertInt(range.max, `statRoll.${tier}.max`, 0, PCT_MAX);
    if (range.min > range.max) throw new RangeError(`statRoll.${tier}: min must not exceed max`);
  }

  assertInt(config.combos.pair, "combos.pair", 0, PCT_MAX);
  assertInt(config.combos.threeOfAKind, "combos.threeOfAKind", 0, PCT_MAX);
}
