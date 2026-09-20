// The pure round resolver. Inputs are treated as hostile: every field is
// validated before any money or fight math runs, and everything a mode
// returns is checked before it is trusted.

import type { RoundConfig } from "@/config/round";
import { ROSTER, TIERS } from "@/config/roster";
import { buildCombatant, type Combatant } from "./combat";
import { isFacing, type RoundEvent } from "./events";
import { assertInt } from "./intmath";
import type { RoundMode } from "./modes/types";
import { assertConservation, computePot, computeRake, type Payout } from "./payout";
import { pull, validateReelConfig, type Pull } from "./reels";
import { createRng } from "./rng";

export interface Entrant {
  readonly id: string;
}

export interface RoundResult {
  reels: Pull[];
  characters: Combatant[];
  log: RoundEvent[];
  placements: string[];
  payouts: Payout[];
  /** Total staked, integer minor units. */
  pot: number;
  /** House take, integer minor units. payouts sum to pot minus rake. */
  rake: number;
}

const SEED_MAX_LENGTH = 256;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED_IDS = new Set(["__proto__", "constructor", "prototype"]);
const EVENT_TYPES = new Set(["spawn", "move", "attack", "hit", "death", "storm", "win"]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function validateSeed(seed: unknown): asserts seed is string {
  if (typeof seed !== "string" || seed.length < 1 || seed.length > SEED_MAX_LENGTH) {
    throw new RangeError(`seed must be a string of 1 to ${SEED_MAX_LENGTH} characters`);
  }
}

function validateMode(mode: unknown): asserts mode is RoundMode {
  if (!isObject(mode)) throw new TypeError("mode must be a strategy object");
  if (typeof mode.id !== "string" || mode.id.length < 1) throw new TypeError("mode.id must be a non empty string");
  assertInt(mode.minEntrants as number, "mode.minEntrants", 2, 1024);
  assertInt(mode.maxEntrants as number, "mode.maxEntrants", 2, 1024);
  if ((mode.minEntrants as number) > (mode.maxEntrants as number)) throw new RangeError("mode.minEntrants exceeds mode.maxEntrants");
  if (typeof mode.simulate !== "function" || typeof mode.distribute !== "function") {
    throw new TypeError("mode must implement simulate and distribute");
  }
}

function validateRoundConfig(config: unknown): asserts config is RoundConfig {
  if (!isObject(config)) throw new TypeError("config must be an object");
  validateMode(config.mode);
  const c = config as unknown as RoundConfig;

  validateReelConfig(c.reels, ROSTER);

  if (!isObject(c.baseStats)) throw new TypeError("baseStats must be an object");
  for (const tier of TIERS) {
    const s = c.baseStats[tier];
    if (!isObject(s)) throw new TypeError(`baseStats.${tier} must be an object`);
    assertInt(s.hp, `baseStats.${tier}.hp`, 1, 1_000_000);
    assertInt(s.atk, `baseStats.${tier}.atk`, 0, 1_000_000);
    assertInt(s.def, `baseStats.${tier}.def`, 0, 1_000_000);
    assertInt(s.spd, `baseStats.${tier}.spd`, 0, 16);
  }

  if (!isObject(c.arena)) throw new TypeError("arena must be an object");
  assertInt(c.arena.width, "arena.width", 4, 256);
  assertInt(c.arena.height, "arena.height", 4, 256);
  if (c.arena.width * c.arena.height < c.mode.maxEntrants * 2) throw new RangeError("arena too small for mode.maxEntrants");

  assertInt(c.maxTicks, "maxTicks", 1, 100_000);
  assertInt(c.stormDamage, "stormDamage", 1, 1_000_000);
  assertInt(c.damageVariancePct, "damageVariancePct", 0, 100);
  assertInt(c.minDamage, "minDamage", 0, 1_000_000);

  if (!isObject(c.stakeTiers)) throw new TypeError("stakeTiers must be an object");
  for (const [name, stake] of Object.entries(c.stakeTiers)) {
    assertInt(stake, `stakeTiers.${name}`, 1, 1_000_000_000_000_000);
  }
  if (typeof c.stakeTier !== "string" || !hasOwn(c.stakeTiers, c.stakeTier)) {
    throw new RangeError(`stakeTier must name one of stakeTiers, got ${String(c.stakeTier)}`);
  }
  assertInt(c.rakeBps, "rakeBps", 0, 10_000);
}

function validateEntrants(entrants: unknown, mode: RoundMode): asserts entrants is readonly Entrant[] {
  if (!Array.isArray(entrants)) throw new TypeError("entrants must be an array");
  if (entrants.length < mode.minEntrants || entrants.length > mode.maxEntrants) {
    throw new RangeError(`entrants: ${mode.id} needs between ${mode.minEntrants} and ${mode.maxEntrants}, got ${entrants.length}`);
  }
  const seen = new Set<string>();
  entrants.forEach((e, i) => {
    if (!isObject(e) || typeof e.id !== "string" || !ID_PATTERN.test(e.id) || RESERVED_IDS.has(e.id)) {
      throw new TypeError(`entrant[${i}].id must match ${ID_PATTERN} and not be a reserved name`);
    }
    if (seen.has(e.id)) throw new RangeError(`entrant ids must be unique, duplicate ${e.id}`);
    seen.add(e.id);
  });
}

function validateLog(log: unknown, ids: ReadonlySet<string>): asserts log is RoundEvent[] {
  if (!Array.isArray(log) || log.length < 1) throw new TypeError("mode returned an empty or non array log");
  let lastT = 0;
  log.forEach((ev, i) => {
    if (!isObject(ev)) throw new TypeError(`log[${i}] is not an object`);
    assertInt(ev.t as number, `log[${i}].t`, lastT);
    lastT = ev.t as number;
    if (!EVENT_TYPES.has(ev.type as string)) throw new TypeError(`log[${i}].type ${String(ev.type)} is unknown`);
    if (typeof ev.actor !== "string" || !ids.has(ev.actor)) throw new TypeError(`log[${i}].actor is not an entrant`);
    if (ev.target !== null && (typeof ev.target !== "string" || !ids.has(ev.target))) throw new TypeError(`log[${i}].target is not an entrant`);
    if (!isFacing(ev.facing)) throw new TypeError(`log[${i}].facing must be 0 to 3`);
    assertInt(ev.value as number, `log[${i}].value`, 0);
  });
}

function validateCoverage(ids: readonly string[], expected: ReadonlySet<string>, what: string): void {
  if (ids.length !== expected.size || new Set(ids).size !== ids.length || ids.some((id) => !expected.has(id))) {
    throw new Error(`mode returned ${what} that do not cover every entrant exactly once`);
  }
}

export function resolveRound(seed: string, entrants: readonly Entrant[], config: RoundConfig): RoundResult {
  validateSeed(seed);
  validateRoundConfig(config);
  validateEntrants(entrants, config.mode);

  const ids = new Set(entrants.map((e) => e.id));
  const rng = createRng(seed);

  const reels = entrants.map(() => pull(rng, ROSTER, config.reels));
  const characters = entrants.map((e, i) => buildCombatant(e.id, reels[i], config.baseStats[reels[i].characterTier]));

  const { log, placements } = config.mode.simulate({
    rng,
    combatants: characters,
    arena: { width: config.arena.width, height: config.arena.height },
    maxTicks: config.maxTicks,
    stormDamage: config.stormDamage,
    damageVariancePct: config.damageVariancePct,
    minDamage: config.minDamage,
  });
  validateLog(log, ids);
  validateCoverage(placements, ids, "placements");

  const pot = computePot(config.stakeTiers[config.stakeTier], entrants.length);
  const rake = computeRake(pot, config.rakeBps);
  const prize = pot - rake;

  const payouts = config.mode.distribute(prize, placements);
  if (!Array.isArray(payouts) || payouts.some((p) => !isObject(p) || typeof p.entrantId !== "string")) {
    throw new TypeError("mode returned malformed payouts");
  }
  validateCoverage(payouts.map((p) => p.entrantId), ids, "payouts");
  assertConservation(payouts, prize);

  return { reels, characters, log, placements, payouts, pot, rake };
}
