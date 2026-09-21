// Candidate defaults at the live ratio: a seat is a tenth of a funded wallet.
// More seeds, because the clean EV figure is driven by rare jackpots and a
// five seed mean moves by more than the differences being compared.
import { economyConfig } from "../../src/config/economy";
import { simulate } from "../../src/economy/simulate";

const SEEDS = ["economy", "night", "dusk", "flint", "ember", "atlas", "blaze", "comet", "delta", "pit", "reel", "lever"];
const ROUNDS = 2000;

function row(label: string, terms: Parameters<typeof economyConfig>[1]): void {
  const runs = SEEDS.map((seed) =>
    simulate({ rounds: ROUNDS, entrants: 24, seed, bankShare: 0, startingBalance: 100n, treasury: 500n, borrowToStakes: 3n, economy: economyConfig(10n, terms) }),
  );
  const avg = (f: (r: (typeof runs)[number]) => number) => runs.reduce((s, r) => s + f(r), 0) / runs.length;
  const evs = runs.map((r) => r.evPerCleanRound).sort((a, b) => a - b);
  const wrecks = avg((r) => r.wrecksPer100Rounds);
  console.log(
    "  " +
      label.padEnd(30) +
      wrecks.toFixed(2).padStart(10) +
      avg((r) => (100 * r.wrecksByReason["debt above the ceiling"]) / ROUNDS).toFixed(2).padStart(9) +
      avg((r) => (100 * r.wrecksByReason["broke and denied credit"]) / ROUNDS).toFixed(2).padStart(8) +
      avg((r) => r.evPerCleanRound).toFixed(4).padStart(10) +
      `${evs[0].toFixed(3)} to ${evs[evs.length - 1].toFixed(3)}`.padStart(18) +
      avg((r) => (100 * Number(r.operatorInjected)) / ROUNDS).toFixed(1).padStart(13) +
      avg((r) => Number(r.treasuryEnd)).toFixed(0).padStart(10) +
      avg((r) => r.loans).toFixed(0).padStart(7) +
      avg((r) => Number(r.interestCollected)).toFixed(0).padStart(10) +
      avg((r) => Number(r.writtenOff)).toFixed(0).padStart(9),
  );
}

console.log("  " + "config".padEnd(30) + "wrecks/100".padStart(10) + "ceiling".padStart(9) + "denied".padStart(8) + "EV clean".padStart(10) + "EV range".padStart(18) + "operator/100".padStart(13) + "bank end".padStart(10) + "loans".padStart(7) + "interest".padStart(10) + "written".padStart(9));
row("shipped: i10% p50 ceiling60", {});
// The bank must never lend an agent past the ceiling, so principal stays at
// or under it. Anything else is a loan that wrecks on arrival.
for (const interestBps of [1_000, 2_000, 4_000]) {
  for (const [maxPrincipalWei, debtCeilingWei] of [[30n, 40n], [30n, 50n], [40n, 60n], [50n, 60n]] as const) {
    row(`i${interestBps / 100}% p${maxPrincipalWei} ceiling${debtCeilingWei}`, { interestBps, maxPrincipalWei, debtCeilingWei });
  }
}
