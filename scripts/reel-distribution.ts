// Rarity distribution over N pulls so the reel weights and combo table can
// be tuned. Usage: npm run reel-report [-- pulls seed]

import { ROSTER, TIERS, type Tier } from "../src/config/roster";
import { DEFAULT_REELS } from "../src/config/reels";
import { pull } from "../src/engine/reels";
import { createRng } from "../src/engine/rng";

const pulls = Number.parseInt(process.argv[2] ?? "100000", 10);
const seed = process.argv[3] ?? "reel-distribution";
const rng = createRng(seed);
const tierOf = new Map(ROSTER.map((e) => [e.id, e.tier] as const));

const reelTier: Record<Tier, number>[] = [0, 1, 2].map(() => ({ common: 0, uncommon: 0, rare: 0 }));
const character: Record<string, number> = Object.fromEntries(ROSTER.map((e) => [e.id, 0]));
const combos = { none: 0, pair: 0, threeOfAKind: 0 };
const threeByTier: Record<Tier, number> = { common: 0, uncommon: 0, rare: 0 };

for (let i = 0; i < pulls; i++) {
  const p = pull(rng, ROSTER, DEFAULT_REELS);
  p.symbols.forEach((s, r) => reelTier[r][tierOf.get(s)!]++);
  character[p.characterId]++;
  combos[p.combo]++;
  if (p.combo === "threeOfAKind") threeByTier[p.characterTier]++;
}

const pct = (n: number) => ((100 * n) / pulls).toFixed(3).padStart(7) + "%";
console.log(`pulls: ${pulls}  seed: ${seed}  weights: ${JSON.stringify(DEFAULT_REELS.tierWeights)}`);
console.log("\nper reel tier share");
for (const tier of TIERS) console.log(`  ${tier.padEnd(9)} ${reelTier.map((r) => pct(r[tier])).join("  ")}`);
console.log("\nreel 1 character share");
for (const e of ROSTER) console.log(`  ${e.tier.padEnd(9)} ${e.id.padEnd(14)} ${pct(character[e.id])}`);
console.log("\ncombinations");
for (const [k, v] of Object.entries(combos)) console.log(`  ${k.padEnd(13)} ${pct(v)}  (${v})`);
console.log("\nthree of a kind by tier");
for (const tier of TIERS) console.log(`  ${tier.padEnd(9)} ${pct(threeByTier[tier])}  (${threeByTier[tier]})`);
