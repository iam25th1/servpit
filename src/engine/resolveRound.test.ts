import { describe, expect, it } from "vitest";
import { DEFAULT_ROUND, type RoundConfig } from "@/config/round";
import type { RoundMode } from "./modes/types";
import { isFacing } from "./events";
import { resolveRound, type Entrant } from "./resolveRound";

const entrants = (n: number): Entrant[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const cfg = (patch: Partial<RoundConfig> = {}): RoundConfig => {
  const { mode, ...data } = DEFAULT_ROUND;
  return { ...structuredClone(data), mode, ...patch };
};

describe("resolveRound", () => {
  it("is pure: same inputs give a deep equal result and inputs are untouched", () => {
    const e = entrants(20);
    const c = cfg();
    const before = JSON.stringify({ e, c });
    const a = resolveRound("seed-1", e, c);
    const b = resolveRound("seed-1", e, c);
    expect(a).toEqual(b);
    expect(JSON.stringify({ e, c })).toBe(before);
  });

  it("different seeds give different logs", () => {
    const e = entrants(16);
    expect(resolveRound("x", e, cfg()).log).not.toEqual(resolveRound("y", e, cfg()).log);
  });

  it("returns reels and characters for every entrant in entrant order", () => {
    const e = entrants(18);
    const r = resolveRound("s", e, cfg());
    expect(r.reels).toHaveLength(18);
    expect(r.characters.map((c) => c.entrantId)).toEqual(e.map((x) => x.id));
    for (const c of r.characters) {
      for (const v of [c.stats.hp, c.stats.atk, c.stats.def, c.stats.spd]) expect(Number.isSafeInteger(v)).toBe(true);
      expect(c.stats.hp).toBeGreaterThan(0);
    }
  });

  it("log covers spawn, move, attack, hit, death and win, in tick order", () => {
    const r = resolveRound("types", entrants(24), cfg());
    const types = new Set<string>(r.log.map((ev) => ev.type));
    for (const t of ["spawn", "move", "attack", "hit", "death", "win"]) expect(types.has(t), t).toBe(true);
    for (let i = 1; i < r.log.length; i++) expect(r.log[i].t).toBeGreaterThanOrEqual(r.log[i - 1].t);
    expect(r.log.filter((ev) => ev.type === "spawn")).toHaveLength(24);
    expect(r.log.filter((ev) => ev.type === "death")).toHaveLength(23);
    expect(r.log.at(-1)?.type).toBe("win");
  });

  it("every event carries a valid facing and a known actor", () => {
    const e = entrants(32);
    const ids = new Set(e.map((x) => x.id));
    const r = resolveRound("facing", e, cfg());
    for (const ev of r.log) {
      expect(isFacing(ev.facing), JSON.stringify(ev)).toBe(true);
      expect(ids.has(ev.actor)).toBe(true);
      if (ev.target !== null) expect(ids.has(ev.target)).toBe(true);
    }
  });

  it("spawn and move events carry positions inside the arena", () => {
    const c = cfg();
    const r = resolveRound("pos", entrants(16), c);
    const positioned = r.log.filter((ev) => ev.type === "spawn" || ev.type === "move");
    expect(positioned.length).toBeGreaterThan(16);
    for (const ev of positioned) {
      expect(Number.isInteger(ev.x) && ev.x! >= 0 && ev.x! < c.arena.width).toBe(true);
      expect(Number.isInteger(ev.y) && ev.y! >= 0 && ev.y! < c.arena.height).toBe(true);
    }
    const spawnTiles = r.log.filter((ev) => ev.type === "spawn").map((ev) => `${ev.x},${ev.y}`);
    expect(new Set(spawnTiles).size).toBe(16);
  });

  it("move events face the direction of travel", () => {
    const r = resolveRound("travel", entrants(16), cfg());
    const last = new Map<string, { x: number; y: number }>();
    for (const ev of r.log) {
      if (ev.type === "spawn") last.set(ev.actor, { x: ev.x!, y: ev.y! });
      if (ev.type === "move") {
        const p = last.get(ev.actor)!;
        const dx = ev.x! - p.x;
        const dy = ev.y! - p.y;
        expect(Math.abs(dx) + Math.abs(dy)).toBe(1);
        const expected = dx > 0 ? 3 : dx < 0 ? 2 : dy > 0 ? 0 : 1;
        expect(ev.facing).toBe(expected);
        last.set(ev.actor, { x: ev.x!, y: ev.y! });
      }
    }
  });

  it("hit events report damage and remaining hp that reconcile to the death", () => {
    const r = resolveRound("hp", entrants(16), cfg());
    const hp = new Map<string, number>();
    for (const ev of r.log) {
      if (ev.type === "spawn") hp.set(ev.actor, ev.value);
      if (ev.type === "hit" || ev.type === "storm") {
        expect(ev.value).toBeGreaterThan(0);
        hp.set(ev.actor, hp.get(ev.actor)! - ev.value);
        expect(ev.hp).toBe(Math.max(0, hp.get(ev.actor)!));
      }
      if (ev.type === "death") expect(hp.get(ev.actor)!).toBeLessThanOrEqual(0);
    }
  });

  it("storm ends a stalled round with exactly one survivor and conservation intact", () => {
    const e = entrants(16);
    const r = resolveRound("storm", e, cfg({ maxTicks: 1, stormDamage: 50 }));
    expect(r.log.some((ev) => ev.type === "storm")).toBe(true);
    expect(r.log.filter((ev) => ev.type === "death")).toHaveLength(15);
    expect(r.log.at(-1)?.type).toBe("win");
    expect(r.payouts.reduce((s, p) => s + p.amount, 0)).toBe(r.pot - r.rake);
  });

  it("placements are a permutation of entrants with the winner first", () => {
    const e = entrants(25);
    const r = resolveRound("place", e, cfg());
    expect([...r.placements].sort()).toEqual(e.map((x) => x.id).sort());
    expect(r.log.at(-1)?.actor).toBe(r.placements[0]);
  });

  it("payouts sum exactly to pot minus rake, in integer minor units", () => {
    for (const [tier, rakeBps] of [["low", 0], ["high", 0], ["low", 250], ["high", 333]] as const) {
      const e = entrants(21);
      const c = cfg({ stakeTier: tier, rakeBps });
      const r = resolveRound(`pay-${tier}-${rakeBps}`, e, c);
      const stake = c.stakeTiers[tier];
      expect(r.pot).toBe(stake * 21);
      expect(r.rake).toBe(Number((BigInt(r.pot) * BigInt(rakeBps)) / BigInt(10_000)));
      const sum = r.payouts.reduce((s, p) => s + p.amount, 0);
      expect(sum).toBe(r.pot - r.rake);
      expect(r.payouts.map((p) => p.entrantId).sort()).toEqual(e.map((x) => x.id).sort());
      for (const p of r.payouts) expect(Number.isSafeInteger(p.amount) && p.amount >= 0).toBe(true);
      expect(r.payouts.find((p) => p.entrantId === r.placements[0])?.amount).toBe(r.pot - r.rake);
    }
  });

  it("round trips through JSON unchanged", () => {
    const r = resolveRound("json", entrants(16), cfg());
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("uses whatever mode strategy the config supplies", () => {
    const stub: RoundMode = {
      id: "stub",
      minEntrants: 2,
      maxEntrants: 4,
      simulate: (ctx) => ({
        log: ctx.combatants.map((c) => ({ t: 0, type: "spawn" as const, actor: c.entrantId, target: null, value: c.stats.hp, facing: 0 as const, x: 0, y: 0 })),
        placements: ctx.combatants.map((c) => c.entrantId),
      }),
      distribute: (prize, placements) => placements.map((id, i) => ({ entrantId: id, amount: i === 0 ? prize - 1 : i === 1 ? 1 : 0 })),
    };
    const r = resolveRound("stub", entrants(3), cfg({ mode: stub }));
    expect(r.placements).toHaveLength(3);
    expect(r.payouts.map((p) => p.amount)).toEqual([r.pot - 1, 1, 0]);
  });

  it("fails closed when a mode breaks conservation", () => {
    const broken: RoundMode = {
      ...DEFAULT_ROUND.mode,
      distribute: (prize, placements) => placements.map((id, i) => ({ entrantId: id, amount: i === 0 ? prize + 1 : 0 })),
    };
    expect(() => resolveRound("broken", entrants(16), cfg({ mode: broken }))).toThrow(/conservation/);
  });
});

describe("resolveRound hostile input", () => {
  it("rejects seeds that are not strings or are empty or too long", () => {
    for (const bad of [42, null, undefined, {}, "", "x".repeat(257)]) {
      expect(() => resolveRound(bad as unknown as string, entrants(16), cfg())).toThrow(/seed/);
    }
  });

  it("rejects entrant counts outside the mode bounds", () => {
    expect(() => resolveRound("n", entrants(15), cfg())).toThrow(/entrants/);
    expect(() => resolveRound("n", entrants(33), cfg())).toThrow(/entrants/);
    expect(() => resolveRound("n", {} as unknown as Entrant[], cfg())).toThrow(/entrants/);
  });

  it("rejects duplicate, malformed or prototype polluting entrant ids", () => {
    const dup = entrants(16);
    dup[5] = { id: "p0" };
    expect(() => resolveRound("d", dup, cfg())).toThrow(/unique/);
    for (const badId of ["", "has space", "a/b", "x".repeat(65), "__proto__", "constructor", "prototype"]) {
      const e = entrants(16);
      e[0] = { id: badId };
      expect(() => resolveRound("d", e, cfg()), badId).toThrow(/entrant/);
    }
    const e = entrants(16);
    e[0] = { id: 7 as unknown as string };
    expect(() => resolveRound("d", e, cfg())).toThrow(/entrant/);
  });

  it("rejects fractional, negative, NaN or missing money config", () => {
    expect(() => resolveRound("m", entrants(16), cfg({ rakeBps: 10_001 }))).toThrow(/rakeBps/);
    expect(() => resolveRound("m", entrants(16), cfg({ rakeBps: -1 }))).toThrow(/rakeBps/);
    expect(() => resolveRound("m", entrants(16), cfg({ rakeBps: 0.5 }))).toThrow(/rakeBps/);
    expect(() => resolveRound("m", entrants(16), cfg({ stakeTiers: { low: 10.5, high: 1000 } }))).toThrow(/stakeTiers/);
    expect(() => resolveRound("m", entrants(16), cfg({ stakeTiers: { low: 0, high: 1000 } }))).toThrow(/stakeTiers/);
    expect(() => resolveRound("m", entrants(16), cfg({ stakeTier: "vip" as "low" }))).toThrow(/stakeTier/);
  });

  it("rejects arena and tick settings that could not terminate or fit the field", () => {
    expect(() => resolveRound("a", entrants(16), cfg({ arena: { width: 3, height: 3 } }))).toThrow(/arena/);
    expect(() => resolveRound("a", entrants(16), cfg({ maxTicks: 0 }))).toThrow(/maxTicks/);
    expect(() => resolveRound("a", entrants(16), cfg({ stormDamage: 0 }))).toThrow(/stormDamage/);
  });

  it("rejects a config whose mode is not a strategy object", () => {
    expect(() => resolveRound("mode", entrants(16), cfg({ mode: "battleRoyale" as unknown as RoundMode }))).toThrow(/mode/);
  });
});
