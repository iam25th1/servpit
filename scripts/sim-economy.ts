// Plays the economy out headlessly. Default entry point: npm run sim:economy
//
//   npm run sim:economy -- --rounds 500 --seed night
//
// No chain, no SERV, no keys. The resolver is the real one and the decisions
// are the same heuristic the game falls back to, so what this measures is the
// economy the game would actually run.
//
// Reports at three settings of the bank's share of an unclaimed prize, which
// is the one lever that decides whether the bank has a source of capital that
// is not the operator topping it up.

import { parseArgs } from "node:util";
import { NAMED_AGENTS } from "../src/config/agents";
import { economyConfig } from "../src/config/economy";
import { simulate, type SimReport } from "../src/economy/simulate";

const { values } = parseArgs({
  options: {
    rounds: { type: "string", default: "2000" },
    entrants: { type: "string", default: "24" },
    seed: { type: "string", default: "economy" },
    stake: { type: "string", default: "10" },
    balance: { type: "string", default: "100" },
    treasury: { type: "string", default: "500" },
  },
});

function intArg(name: string, raw: string, low: number, high: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n < low || n > high || String(n) !== raw.trim()) {
    throw new RangeError(`--${name} must be an integer in [${low}, ${high}], got ${raw}`);
  }
  return n;
}

const rounds = intArg("rounds", values.rounds, 1, 1_000_000);
const entrants = intArg("entrants", values.entrants, NAMED_AGENTS.length, 1024);
const stake = BigInt(intArg("stake", values.stake, 1, 1_000_000));
const startingBalance = BigInt(intArg("balance", values.balance, 1, 1_000_000));
const treasury = BigInt(intArg("treasury", values.treasury, 0, 100_000_000));

const SHARES = [0, 0.5, 1];

const economy = economyConfig(stake);
const reports = SHARES.map((bankShare) =>
  simulate({ rounds, entrants, seed: values.seed, bankShare, startingBalance, treasury, borrowToStakes: 3n, economy }),
);

const pad = (value: string | number, width: number): string => String(value).padStart(width);
const orNever = (value: number | null): string => (value === null ? "never" : String(value));

console.log(`servpit economy sim: ${rounds} rounds x ${entrants} seats, seed "${values.seed}", chips throughout`);
console.log(`  seat ${stake}, agent opening balance ${startingBalance}, bank opening treasury ${treasury}, ${NAMED_AGENTS.length} agents`);
console.log(
  `  credit: min loan ${economy.minLoanWei}, max principal ${economy.maxPrincipalWei}, ${economy.maxTreasuryShareBps / 100}% of treasury per loan, ` +
    `${economy.interestBps / 100}% interest per round, debt ceiling ${economy.debtCeilingWei}, replacement debt ${economy.replacementDebtWei}`,
);

console.log("\nbank share of an unclaimed prize");
console.log("  share  first broke  first wreck  wrecks  per 100  ceiling  denied  treasury end    min    max  dry  loans   lent  interest  written off  operator in  rollover end  agent EV/round");

for (const r of reports) {
  console.log(
    `  ${pad(r.config.bankShare.toFixed(1), 5)}  ${pad(orNever(r.firstBrokeRound), 11)}  ${pad(orNever(r.firstWreckRound), 11)}  ` +
      `${pad(r.wrecks, 6)}  ${pad(r.wrecksPer100Rounds.toFixed(2), 7)}  ${pad(r.wrecksByReason["debt above the ceiling"], 7)}  ` +
      `${pad(r.wrecksByReason["broke and denied credit"], 6)}  ${pad(r.treasuryEnd.toString(), 12)}  ${pad(r.treasuryMin.toString(), 5)}  ${pad(r.treasuryMax.toString(), 5)}  ` +
      `${pad(r.dryRounds, 3)}  ${pad(r.loans, 5)}  ${pad(r.lent.toString(), 5)}  ${pad(r.interestCollected.toString(), 8)}  ${pad(r.writtenOff.toString(), 11)}  ` +
      `${pad(r.operatorInjected.toString(), 11)}  ${pad(r.rolloverEnd.toString(), 12)}  ${pad(r.evPerAgentPerRound.toFixed(4), 14)}`,
  );
}

/** Ten readings across the run, so the shape is visible rather than the ends. */
function samples(report: SimReport): string {
  const step = Math.max(1, Math.floor(report.treasurySeries.length / 10));
  const picked: string[] = [];
  for (let i = step - 1; i < report.treasurySeries.length; i += step) picked.push(report.treasurySeries[i].toString());
  return picked.slice(0, 10).join(" ");
}

console.log("\nbank treasury over time (ten readings, evenly spaced)");
for (const r of reports) console.log(`  share ${r.config.bankShare.toFixed(1)}  ${r.treasuryStart} -> ${samples(r)}`);

console.log("\nflags");
let flagged = 0;
for (const r of reports) {
  for (const flag of r.flags) {
    console.log(`  share ${r.config.bankShare.toFixed(1)}: ${flag}`);
    flagged += 1;
  }
}
if (flagged === 0) console.log("  none: every setting kept the bank solvent and wrecked agents at a rate that is neither zero nor immediate");
