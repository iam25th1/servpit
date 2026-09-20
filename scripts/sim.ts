// Headless simulation harness. Default dev entry point: npm run sim
//
//   npm run sim -- --rounds 2000 --entrants 32 --seed night --tier high
//
// Prints rarity distribution, win rate by roster entry and by combo,
// average round length, and the payout conservation and facing checks.
// Exits non zero if any round breaks conservation or emits a bad facing.

import { parseArgs } from "node:util";
import { DEFAULT_ROUND, type StakeTier } from "../src/config/round";
import { ROSTER, TIERS } from "../src/config/roster";
import { resolveRound, type RoundResult } from "../src/engine/resolveRound";
import { aggregate } from "./lib/sim-stats";

const { values } = parseArgs({
  options: {
    rounds: { type: "string", default: "1000" },
    entrants: { type: "string", default: "24" },
    seed: { type: "string", default: "sim" },
    tier: { type: "string", default: "low" },
  },
});

function intArg(name: string, raw: string, min: number, max: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n < min || n > max || String(n) !== raw.trim()) {
    throw new RangeError(`--${name} must be an integer in [${min}, ${max}], got ${raw}`);
  }
  return n;
}

const rounds = intArg("rounds", values.rounds, 1, 1_000_000);
const entrantCount = intArg("entrants", values.entrants, 2, 1024);
if (!Object.prototype.hasOwnProperty.call(DEFAULT_ROUND.stakeTiers, values.tier)) {
  throw new RangeError(`--tier must be one of ${Object.keys(DEFAULT_ROUND.stakeTiers).join(", ")}`);
}
const config = { ...DEFAULT_ROUND, stakeTier: values.tier as StakeTier };
const entrants = Array.from({ length: entrantCount }, (_, i) => ({ id: `p${i}` }));

const started = performance.now();
const results: RoundResult[] = [];
for (let i = 0; i < rounds; i++) results.push(resolveRound(`${values.seed}-${i}`, entrants, config));
const elapsedMs = performance.now() - started;

const s = aggregate(results);
const pct = (n: number, d: number) => (d === 0 ? "   n/a" : ((100 * n) / d).toFixed(2).padStart(6) + "%");
const appearances = s.rounds * s.entrantsPerRound;

console.log(`servpit sim: ${s.rounds} rounds x ${s.entrantsPerRound} entrants, seed "${values.seed}", stake tier ${config.stakeTier} (${config.stakeTiers[config.stakeTier]} minor units), rake ${config.rakeBps} bps, ${elapsedMs.toFixed(0)} ms`);

console.log("\nrarity distribution (reel 1 character tier, share of all pulls)");
for (const tier of TIERS) console.log(`  ${tier.padEnd(9)} ${pct(s.byTier[tier], appearances)}  (${s.byTier[tier]})`);

console.log("\ncombination distribution and win rate by combo (baseline win rate is 1 / entrants)");
console.log(`  baseline      ${pct(1, s.entrantsPerRound)}`);
for (const [combo, t] of Object.entries(s.byCombo)) {
  console.log(`  ${combo.padEnd(13)} share ${pct(t.appearances, appearances)}  wins ${String(t.wins).padStart(5)} / ${String(t.appearances).padStart(6)}  win rate ${pct(t.wins, t.appearances)}`);
}

console.log("\nwin rate by roster entry (wins / appearances)");
for (const e of ROSTER) {
  const t = s.byCharacter[e.id];
  console.log(`  ${e.tier.padEnd(9)} ${e.id.padEnd(14)} ${String(t.wins).padStart(5)} / ${String(t.appearances).padStart(6)}  ${pct(t.wins, t.appearances)}`);
}

console.log("\nround length");
console.log(`  avg events per round ${s.avgEvents.toFixed(1)}   avg ticks ${s.avgTicks.toFixed(1)}   min ticks ${s.minTicks}   max ticks ${s.maxTicks}   rounds reaching storm ${s.stormRounds}`);
console.log(`  event mix per round: ${Object.entries(s.eventTypes).map(([k, v]) => `${k} ${(v / s.rounds).toFixed(1)}`).join(", ")}`);

console.log("\nchecks");
const conservationHolds = s.conservationOk === s.rounds;
console.log(`  payout conservation (sum of payouts == pot - rake, integer minor units): ${s.conservationOk} / ${s.rounds} rounds ${conservationHolds ? "OK, holds in every round" : "FAILED"}`);
const facingOk = s.invalidFacingEvents === 0 && s.eventsWithoutFacing === 0;
console.log(`  facing on every event: ${facingOk ? "OK" : "FAILED"} (${s.eventsWithoutFacing} missing, ${s.invalidFacingEvents} invalid)`);

if (!conservationHolds || !facingOk) process.exitCode = 1;
