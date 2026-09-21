// Sweeps interest and debt ceiling at a bank share of 0, with replacements
// born clean and born in debt, against the ranked targets.
import { economyConfig } from "../../src/config/economy";
import { simulate } from "../../src/economy/simulate";

const SEEDS = ["economy", "night", "dusk", "flint", "ember"];
const ROUNDS = 2000;
const base = { rounds: ROUNDS, entrants: 24, startingBalance: 100n, treasury: 500n, borrowToStakes: 3n, bankShare: 0 };

interface Row {
  label: string;
  wrecksPer100: number;
  ceiling: number;
  denied: number;
  evClean: number;
  evIndebted: number;
  operatorPer100: number;
  treasuryEnd: number;
  interest: number;
  writtenOff: number;
  loans: number;
  cleanShare: number;
  flags: number;
}

function mean(label: string, overrides: Parameters<typeof economyConfig>[1]): Row {
  const runs = SEEDS.map((seed) => simulate({ ...base, seed, economy: economyConfig(10n, overrides) }));
  const avg = (f: (r: (typeof runs)[number]) => number) => runs.reduce((s, r) => s + f(r), 0) / runs.length;
  return {
    label,
    wrecksPer100: avg((r) => r.wrecksPer100Rounds),
    ceiling: avg((r) => (100 * r.wrecksByReason["debt above the ceiling"]) / ROUNDS),
    denied: avg((r) => (100 * r.wrecksByReason["broke and denied credit"]) / ROUNDS),
    evClean: avg((r) => r.evPerCleanRound),
    evIndebted: avg((r) => r.evPerIndebtedRound),
    operatorPer100: avg((r) => (100 * Number(r.operatorInjected)) / ROUNDS),
    treasuryEnd: avg((r) => Number(r.treasuryEnd)),
    interest: avg((r) => Number(r.interestCollected)),
    writtenOff: avg((r) => Number(r.writtenOff)),
    loans: avg((r) => r.loans),
    cleanShare: avg((r) => (100 * r.cleanAgentRounds) / (r.cleanAgentRounds + r.indebtedAgentRounds)),
    flags: avg((r) => r.flags.length),
  };
}

const hit = (r: Row) => (r.wrecksPer100 >= 2 && r.wrecksPer100 <= 4 ? " <= in band" : "");

function print(rows: Row[]): void {
  console.log(
    "  " +
      "config".padEnd(30) +
      "wrecks/100".padStart(11) +
      "ceiling".padStart(9) +
      "denied".padStart(8) +
      "EV clean".padStart(10) +
      "EV debt".padStart(10) +
      "operator/100".padStart(14) +
      "bank end".padStart(10) +
      "interest".padStart(10) +
      "written".padStart(9) +
      "loans".padStart(7) +
      "clean%".padStart(8),
  );
  for (const r of rows) {
    console.log(
      "  " +
        r.label.padEnd(30) +
        r.wrecksPer100.toFixed(2).padStart(11) +
        r.ceiling.toFixed(2).padStart(9) +
        r.denied.toFixed(2).padStart(8) +
        r.evClean.toFixed(4).padStart(10) +
        r.evIndebted.toFixed(3).padStart(10) +
        r.operatorPer100.toFixed(1).padStart(14) +
        r.treasuryEnd.toFixed(0).padStart(10) +
        r.interest.toFixed(0).padStart(10) +
        r.writtenOff.toFixed(0).padStart(9) +
        r.loans.toFixed(0).padStart(7) +
        r.cleanShare.toFixed(0).padStart(8) +
        hit(r),
    );
  }
}

const INTERESTS = [2_000, 4_000, 8_000];
const CEILINGS = [40n, 60n, 100n];
const REPLACEMENTS = [0n, 20n, 30n, 50n];

for (const replacementDebtWei of REPLACEMENTS) {
  console.log(`\n=== replacement debt ${replacementDebtWei} chips (${replacementDebtWei === 0n ? "born clean" : "born in debt"}) ===`);
  const rows: Row[] = [];
  for (const interestBps of INTERESTS) {
    for (const debtCeilingWei of CEILINGS) {
      if (replacementDebtWei >= debtCeilingWei) continue; // born past the ceiling is not a setting, it is a bug
      rows.push(mean(`i${interestBps / 100}% ceiling${debtCeilingWei}`, { interestBps, debtCeilingWei, replacementDebtWei }));
    }
  }
  print(rows);
}
