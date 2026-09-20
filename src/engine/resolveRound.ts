// The pure round resolver. Inputs are treated as hostile: every field is
// read exactly once into a plain snapshot, validated before any money or
// fight math runs, and everything a mode returns is copied field by field
// before it is trusted. Getters, proxies and extra fields never reach the
// result.

import type { RoundConfig } from "@/config/round";
import { ROSTER, TIERS } from "@/config/roster";
import { buildCombatant, type Combatant } from "./combat";
import { isFacing, type EventType, type RoundEvent } from "./events";
import { assertInt } from "./intmath";
import type { FightContext, RoundMode } from "./modes/types";
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
const EVENT_TYPES: ReadonlySet<string> = new Set<EventType>(["spawn", "move", "attack", "hit", "death", "storm", "win"]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function validateSeed(seed: unknown): asserts seed is string {
  if (typeof seed !== "string" || seed.length < 1 || seed.length > SEED_MAX_LENGTH) {
    throw new RangeError(`seed must be a string of 1 to ${SEED_MAX_LENGTH} characters`);
  }
}

/** Reads the strategy object's members once and returns a plain wrapper around them. */
function readMode(mode: unknown): RoundMode {
  if (!isObject(mode)) throw new TypeError("mode must be a strategy object");
  const id = mode.id;
  const minEntrants = mode.minEntrants;
  const maxEntrants = mode.maxEntrants;
  const simulate = mode.simulate;
  const distribute = mode.distribute;
  if (typeof id !== "string" || id.length < 1) throw new TypeError("mode.id must be a non empty string");
  assertInt(minEntrants as number, "mode.minEntrants", 2, 1024);
  assertInt(maxEntrants as number, "mode.maxEntrants", 2, 1024);
  if ((minEntrants as number) > (maxEntrants as number)) throw new RangeError("mode.minEntrants exceeds mode.maxEntrants");
  if (typeof simulate !== "function" || typeof distribute !== "function") {
    throw new TypeError("mode must implement simulate and distribute");
  }
  return {
    id,
    minEntrants: minEntrants as number,
    maxEntrants: maxEntrants as number,
    simulate: (ctx: FightContext) => (simulate as RoundMode["simulate"]).call(mode, ctx),
    distribute: (prize: number, placements: readonly string[]) => (distribute as RoundMode["distribute"]).call(mode, prize, placements),
  };
}

/** Copies config into plain data (every property read once) and validates it. */
function snapshotConfig(config: unknown): RoundConfig {
  if (!isObject(config)) throw new TypeError("config must be an object");
  const { mode, ...data } = config;
  let plain: Record<string, unknown>;
  try {
    plain = structuredClone(data);
  } catch {
    throw new TypeError("config must be plain data: no functions, symbols or exotic objects outside mode");
  }
  const c = { ...plain, mode: readMode(mode) } as unknown as RoundConfig;

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
  return c;
}

/** Reads each entrant id once, validates it, returns the plain id list. */
function readEntrantIds(entrants: unknown, mode: RoundMode): string[] {
  if (!Array.isArray(entrants)) throw new TypeError("entrants must be an array");
  const n = entrants.length;
  if (n < mode.minEntrants || n > mode.maxEntrants) {
    throw new RangeError(`entrants: ${mode.id} needs between ${mode.minEntrants} and ${mode.maxEntrants}, got ${n}`);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const e: unknown = entrants[i];
    if (!isObject(e)) throw new TypeError(`entrant[${i}] must be an object`);
    const id = e.id;
    if (typeof id !== "string" || !ID_PATTERN.test(id) || RESERVED_IDS.has(id)) {
      throw new TypeError(`entrant[${i}].id must match ${ID_PATTERN} and not be a reserved name`);
    }
    if (seen.has(id)) throw new RangeError(`entrant ids must be unique, duplicate ${id}`);
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Copies the mode's log event by event, reading each field once and dropping anything unknown. */
function normalizeLog(log: unknown, ids: ReadonlySet<string>, arena: RoundConfig["arena"]): RoundEvent[] {
  if (!Array.isArray(log) || log.length < 1) throw new TypeError("mode returned an empty or non array log");
  const n = log.length;
  const out: RoundEvent[] = [];
  let lastT = 0;
  for (let i = 0; i < n; i++) {
    const ev: unknown = log[i];
    if (!isObject(ev)) throw new TypeError(`log[${i}] is not an object`);
    const t = ev.t as number;
    const type = ev.type as EventType;
    const actor = ev.actor;
    const target = ev.target;
    const value = ev.value as number;
    const facing = ev.facing;
    const x = ev.x;
    const y = ev.y;
    const hp = ev.hp;

    assertInt(t, `log[${i}].t`, lastT);
    lastT = t;
    if (!EVENT_TYPES.has(type)) throw new TypeError(`log[${i}].type ${String(type)} is unknown`);
    if (typeof actor !== "string" || !ids.has(actor)) throw new TypeError(`log[${i}].actor is not an entrant`);
    if (target !== null && (typeof target !== "string" || !ids.has(target))) throw new TypeError(`log[${i}].target is not an entrant`);
    if (!isFacing(facing)) throw new TypeError(`log[${i}].facing must be 0 to 3`);
    assertInt(value, `log[${i}].value`, 0);

    const copy: RoundEvent = { t, type, actor, target, value, facing };
    if (x !== undefined || y !== undefined) {
      assertInt(x as number, `log[${i}].x`, 0, arena.width - 1);
      assertInt(y as number, `log[${i}].y`, 0, arena.height - 1);
      copy.x = x as number;
      copy.y = y as number;
    }
    if (hp !== undefined) {
      assertInt(hp as number, `log[${i}].hp`, 0);
      copy.hp = hp as number;
    }
    out.push(copy);
  }
  return out;
}

function normalizePlacements(placements: unknown, ids: ReadonlySet<string>): string[] {
  if (!Array.isArray(placements)) throw new TypeError("mode returned non array placements");
  const out: string[] = [];
  const n = placements.length;
  for (let i = 0; i < n; i++) {
    const id: unknown = placements[i];
    if (typeof id !== "string") throw new TypeError(`placements[${i}] is not a string`);
    out.push(id);
  }
  assertCoverage(out, ids, "placements");
  return out;
}

function normalizePayouts(payouts: unknown, ids: ReadonlySet<string>): Payout[] {
  if (!Array.isArray(payouts)) throw new TypeError("mode returned non array payouts");
  const out: Payout[] = [];
  const n = payouts.length;
  for (let i = 0; i < n; i++) {
    const p: unknown = payouts[i];
    if (!isObject(p)) throw new TypeError(`payouts[${i}] is not an object`);
    const entrantId = p.entrantId;
    const amount = p.amount;
    if (typeof entrantId !== "string") throw new TypeError(`payouts[${i}].entrantId is not a string`);
    assertInt(amount as number, `payouts[${i}].amount`, 0);
    out.push({ entrantId, amount: amount as number });
  }
  assertCoverage(
    out.map((p) => p.entrantId),
    ids,
    "payouts",
  );
  return out;
}

function assertCoverage(found: readonly string[], expected: ReadonlySet<string>, what: string): void {
  if (found.length !== expected.size || new Set(found).size !== found.length || found.some((id) => !expected.has(id))) {
    throw new Error(`mode returned ${what} that do not cover every entrant exactly once`);
  }
}

export function resolveRound(seed: string, entrants: readonly Entrant[], config: RoundConfig): RoundResult {
  validateSeed(seed);
  const c = snapshotConfig(config);
  const ids = readEntrantIds(entrants, c.mode);
  const idSet = new Set(ids);
  const rng = createRng(seed);

  const reels = ids.map(() => pull(rng, ROSTER, c.reels));
  const characters = ids.map((id, i) => buildCombatant(id, reels[i], c.baseStats[reels[i].characterTier]));

  const simulated = c.mode.simulate({
    rng,
    combatants: characters,
    arena: { width: c.arena.width, height: c.arena.height },
    maxTicks: c.maxTicks,
    stormDamage: c.stormDamage,
    damageVariancePct: c.damageVariancePct,
    minDamage: c.minDamage,
  });
  if (!isObject(simulated)) throw new TypeError("mode.simulate must return an object");
  const log = normalizeLog(simulated.log, idSet, c.arena);
  const placements = normalizePlacements(simulated.placements, idSet);

  const pot = computePot(c.stakeTiers[c.stakeTier], ids.length);
  const rake = computeRake(pot, c.rakeBps);
  const prize = pot - rake;

  const payouts = normalizePayouts(c.mode.distribute(prize, placements), idSet);
  assertConservation(payouts, prize);

  return { reels, characters, log, placements, payouts, pot, rake };
}
