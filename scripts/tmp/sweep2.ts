// Is there an honest route to a visible wreck rate, or does it only come from
// replacements that are doomed the moment they take a seat?
import { economyConfig } from "../../src/config/economy";
import { simulate, type SimConfig } from "../../src/economy/simulate";

const SEEDS = ["economy", "night", "dusk", "flint", "ember"];
const ROUNDS = 2000;

function row(label: string, sim: Partial<SimConfig>, terms: Parameters<typeof economyConfig>[1] = {}): void {
  const runs = SEEDS.map((seed) =>
    simulate({ rounds: ROUNDS, entrants: 24, seed, bankShare: 0, startingBalance: 100n, treasury: 500n, borrowToStakes: 3n, economy: economyConfig(10n, terms), ...sim }),
  );
  const avg = (f: (r: (typeof runs)[number]) => number) => runs.reduce((s, r) => s + f(r), 0) / runs.length;
  const wrecks = avg((r) => r.wrecksPer100Rounds);
  console.log(
    "  " +
      label.padEnd(34) +
      wrecks.toFixed(2).padStart(10) +
      avg((r) => (100 * r.wrecksByReason["debt above the ceiling"]) / ROUNDS).toFixed(2).padStart(9) +
      avg((r) => (100 * r.wrecksByReason["broke and denied credit"]) / ROUNDS).toFixed(2).padStart(8) +
      avg((r) => r.evPerCleanRound).toFixed(4).padStart(10) +
      avg((r) => (100 * Number(r.operatorInjected)) / ROUNDS).toFixed(1).padStart(13) +
      avg((r) => Number(r.treasuryEnd)).toFixed(0).padStart(10) +
      avg((r) => r.loans).toFixed(0).padStart(7) +
      avg((r) => Number(r.interestCollected)).toFixed(0).padStart(10) +
      avg((r) => Number(r.writtenOff)).toFixed(0).padStart(9) +
      (wrecks >= 2 && wrecks <= 4 ? "  <= in band" : ""),
  );
}

const head = () =>
  console.log(
    "  " +
      "config".padEnd(34) +
      "wrecks/100".padStart(10) +
      "ceiling".padStart(9) +
      "denied".padStart(8) +
      "EV clean".padStart(10) +
      "operator/100".padStart(13) +
      "bank end".padStart(10) +
      "loans".padStart(7) +
      "interest".padStart(10) +
      "written".padStart(9),
  );

console.log("=== how much bankroll a seat costs, replacements born clean, interest 10%, ceiling 60 ===");
head();
for (const balance of [100n, 60n, 40n, 30n, 20n]) row(`bankroll ${balance} chips, seat 10`, { startingBalance: balance });

console.log("\n=== how far an agent may borrow back, bankroll 100 ===");
head();
for (const borrow of [1n, 2n, 3n, 5n]) row(`borrow up to ${borrow} seats`, { borrowToStakes: borrow });

console.log("\n=== how much principal the bank will carry, bankroll 40 ===");
head();
for (const maxPrincipalWei of [10n, 20n, 30n, 50n]) row(`max principal ${maxPrincipalWei}`, { startingBalance: 40n }, { maxPrincipalWei, debtCeilingWei: maxPrincipalWei + 20n });

console.log("\n=== bankroll 40, sweeping interest and ceiling, born clean ===");
head();
for (const interestBps of [1_000, 2_000, 4_000]) {
  for (const debtCeilingWei of [40n, 60n, 100n]) row(`bankroll 40, i${interestBps / 100}% ceiling${debtCeilingWei}`, { startingBalance: 40n }, { interestBps, debtCeilingWei });
}
