import { describe, expect, it } from "vitest";
import { ROSTER, TIERS, type Tier } from "@/config/roster";
import { DEFAULT_REELS, type ReelConfig } from "@/config/reels";
import { createRng } from "./rng";
import { buildStrip, classifyCombo, pull, spinReel, validateReelConfig } from "./reels";

const tierOf = (id: string): Tier => ROSTER.find((e) => e.id === id)!.tier;

describe("buildStrip", () => {
  it("gives each tier exactly its configured share of total weight", () => {
    const strip = buildStrip(ROSTER, DEFAULT_REELS.tierWeights);
    const totalWeight = Object.values(DEFAULT_REELS.tierWeights).reduce((a, b) => a + b, 0);
    for (const tier of TIERS) {
      const tierSum = strip.symbols.reduce((s, id, i) => s + (tierOf(id) === tier ? strip.weights[i] : 0), 0);
      expect(tierSum * totalWeight).toBe(strip.total * DEFAULT_REELS.tierWeights[tier]);
    }
  });

  it("uses integer weights and splits a tier evenly across its members", () => {
    const strip = buildStrip(ROSTER, DEFAULT_REELS.tierWeights);
    for (const w of strip.weights) expect(Number.isInteger(w) && w > 0).toBe(true);
    const commons = strip.symbols.map((id, i) => [id, strip.weights[i]] as const).filter(([id]) => tierOf(id) === "common");
    expect(new Set(commons.map(([, w]) => w)).size).toBe(1);
  });
});

describe("spinReel", () => {
  it("lands each tier close to its weight over 100,000 spins and is seed deterministic", () => {
    const strip = buildStrip(ROSTER, DEFAULT_REELS.tierWeights);
    const count = (seed: string) => {
      const rng = createRng(seed);
      const hits: Record<Tier, number> = { common: 0, uncommon: 0, rare: 0 };
      for (let i = 0; i < 100_000; i++) hits[tierOf(strip.symbols[spinReel(rng, strip)])]++;
      return hits;
    };
    const a = count("spin");
    expect(a).toEqual(count("spin"));
    expect(a.common / 100_000).toBeCloseTo(0.7, 1);
    expect(a.uncommon / 100_000).toBeCloseTo(0.25, 1);
    expect(a.rare / 100_000).toBeCloseTo(0.05, 1);
  });
});

describe("classifyCombo", () => {
  it("names none, pair and three of a kind", () => {
    expect(classifyCombo(["Knight", "Monk", "Boy"])).toBe("none");
    expect(classifyCombo(["Knight", "Monk", "Knight"])).toBe("pair");
    expect(classifyCombo(["Monk", "Monk", "Boy"])).toBe("pair");
    expect(classifyCombo(["Bear", "Bear", "Bear"])).toBe("threeOfAKind");
  });
});

describe("pull", () => {
  const rng = () => createRng("pull");

  it("returns three symbols, the first of which is the character", () => {
    const p = pull(rng(), ROSTER, DEFAULT_REELS);
    expect(p.symbols).toHaveLength(3);
    expect(p.characterId).toBe(p.symbols[0]);
    for (const s of p.symbols) expect(ROSTER.some((e) => e.id === s)).toBe(true);
  });

  it("derives modifier from reel 2 tier table and stat roll from reel 3 tier range", () => {
    const p = pull(rng(), ROSTER, DEFAULT_REELS);
    const t2 = tierOf(p.symbols[1]);
    const t3 = tierOf(p.symbols[2]);
    expect(DEFAULT_REELS.modifiers[t2].some((m) => m.id === p.modifier.id)).toBe(true);
    expect(p.statRollPct).toBeGreaterThanOrEqual(DEFAULT_REELS.statRoll[t3].min);
    expect(p.statRollPct).toBeLessThanOrEqual(DEFAULT_REELS.statRoll[t3].max);
  });

  it("is fully determined by the symbols, so a replay rebuilds the same pull", () => {
    const a = pull(rng(), ROSTER, DEFAULT_REELS);
    const b = pull(rng(), ROSTER, DEFAULT_REELS);
    expect(a).toEqual(b);
  });

  it("three of a kind is rare but present and pays a bigger bonus than a pair", () => {
    const r = rng();
    const combos = { none: 0, pair: 0, threeOfAKind: 0 };
    for (let i = 0; i < 100_000; i++) combos[pull(r, ROSTER, DEFAULT_REELS).combo]++;
    expect(combos.threeOfAKind).toBeGreaterThan(0);
    expect(combos.threeOfAKind / 100_000).toBeLessThan(0.02);
    expect(DEFAULT_REELS.combos.threeOfAKind).toBeGreaterThan(DEFAULT_REELS.combos.pair);
    expect(DEFAULT_REELS.combos.pair).toBeGreaterThan(0);
  });

  it("bonusPct follows the combination table", () => {
    const r = rng();
    for (let i = 0; i < 2_000; i++) {
      const p = pull(r, ROSTER, DEFAULT_REELS);
      const expected = p.combo === "none" ? 0 : DEFAULT_REELS.combos[p.combo];
      expect(p.bonusPct).toBe(expected);
    }
  });
});

describe("validateReelConfig", () => {
  const clone = (): ReelConfig => structuredClone(DEFAULT_REELS);

  it("accepts the defaults", () => {
    expect(() => validateReelConfig(DEFAULT_REELS, ROSTER)).not.toThrow();
  });

  it("rejects non integer, negative or all zero tier weights", () => {
    const a = clone();
    a.tierWeights.common = 1.5;
    expect(() => validateReelConfig(a, ROSTER)).toThrow(/tierWeights/);
    const b = clone();
    b.tierWeights.rare = -1;
    expect(() => validateReelConfig(b, ROSTER)).toThrow(/tierWeights/);
    const c = clone();
    c.tierWeights = { common: 0, uncommon: 0, rare: 0 };
    expect(() => validateReelConfig(c, ROSTER)).toThrow(/tierWeights/);
  });

  it("rejects an empty modifier table or an inverted stat roll range", () => {
    const a = clone();
    a.modifiers.rare = [];
    expect(() => validateReelConfig(a, ROSTER)).toThrow(/modifiers/);
    const b = clone();
    b.statRoll.common = { min: 10, max: 5 };
    expect(() => validateReelConfig(b, ROSTER)).toThrow(/statRoll/);
  });
});

describe("buildStrip overflow guard", () => {
  it("throws instead of producing unsafe integer weights", () => {
    expect(() => buildStrip(ROSTER, { common: 2 ** 53, uncommon: 1, rare: 1 })).toThrow(RangeError);
  });
});
