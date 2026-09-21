// Asks the real Marrow about a spread of borrowers and prints what it says.
//
// The whole decision path, so what comes out is what a round would get:
// SERV, the schema, the validator and the bounds. No chain, no money.

import { loadLocalEnv } from "../lib/loadEnv";
loadLocalEnv();
import { DEFAULT_SERV } from "../../src/config/serv";
import { ServClient, CostMeter } from "../../src/server/serv/client";
import { createServTransport } from "../../src/server/serv/transport";
import { decideLoan, type BorrowerRecord, type LoanBounds } from "../../src/server/decisions/bank";

/** The bounds a live round hands the lender at the shipped settings. */
const BOUNDS: LoanBounds = { treasuryChips: 971, maxLoanChips: 30, debtCeilingChips: 40, minRateBps: 500, maxRateBps: 3_000 };

interface Case {
  label: string;
  record: BorrowerRecord;
  stakeChips: number;
  shortfallChips: number;
}

const CASES: Case[] = [
  {
    label: "a repayer with wins, asking for a little",
    record: { agentId: "flint", name: "Flint", balanceChips: 60, debtChips: 0, roundsPlayed: 12, wins: 4, repaidChips: 40 },
    stakeChips: 30,
    shortfallChips: 10,
  },
  {
    label: "a proven winner, asking for the most it can",
    record: { agentId: "atlas", name: "Atlas", balanceChips: 100, debtChips: 0, roundsPlayed: 20, wins: 6, repaidChips: 90 },
    stakeChips: 120,
    shortfallChips: 30,
  },
  {
    label: "steady, small debt, pays it down",
    record: { agentId: "delta", name: "Delta", balanceChips: 40, debtChips: 5, roundsPlayed: 10, wins: 3, repaidChips: 25 },
    stakeChips: 40,
    shortfallChips: 15,
  },
  {
    label: "the real Flint: long record, one win, repaid everything",
    record: { agentId: "flint", name: "Flint", balanceChips: 19, debtChips: 0, roundsPlayed: 20, wins: 1, repaidChips: 19 },
    stakeChips: 10,
    shortfallChips: 11,
  },
  {
    label: "the real Ember: long record, never won, never borrowed",
    record: { agentId: "ember", name: "Ember", balanceChips: 16, debtChips: 0, roundsPlayed: 18, wins: 0, repaidChips: 0 },
    stakeChips: 10,
    shortfallChips: 14,
  },
  {
    label: "brand new, no record at all",
    record: { agentId: "onyx", name: "Onyx", balanceChips: 0, debtChips: 0, roundsPlayed: 0, wins: 0, repaidChips: 0 },
    stakeChips: 10,
    shortfallChips: 30,
  },
  {
    label: "five rounds, no wins, never borrowed",
    record: { agentId: "ember", name: "Ember", balanceChips: 16, debtChips: 0, roundsPlayed: 5, wins: 0, repaidChips: 0 },
    stakeChips: 10,
    shortfallChips: 14,
  },
  {
    label: "broke, carrying a debt, nothing paid back",
    record: { agentId: "blaze", name: "Blaze", balanceChips: 2, debtChips: 30, roundsPlayed: 8, wins: 0, repaidChips: 0 },
    stakeChips: 10,
    shortfallChips: 28,
  },
];

async function main(): Promise<void> {
  const key = process.env.SERV_API_KEY;
  if (!key) return void console.log("SERV_API_KEY is not set.");
  const meter = new CostMeter(DEFAULT_SERV.pricing);
  const client = new ServClient(DEFAULT_SERV, createServTransport(key, DEFAULT_SERV));

  let approvals = 0;
  for (const c of CASES) {
    const answer = await decideLoan({ client, meter }, { record: c.record, stakeChips: c.stakeChips, shortfallChips: c.shortfallChips }, BOUNDS);
    const r = c.record;
    if (answer.decision.approve) approvals++;
    console.log(`\n${c.label}`);
    console.log(`  record: holds ${r.balanceChips}, owes ${r.debtChips}, ${r.roundsPlayed} rounds, ${r.wins} wins, repaid ${r.repaidChips}, wants ${c.stakeChips} and is ${c.shortfallChips} short`);
    console.log(`  ${answer.source.toUpperCase()}: ${answer.decision.approve ? `LENDS ${answer.decision.amountChips} at ${answer.decision.rateBps} bps` : "REFUSES"}`);
    console.log(`  "${answer.decision.reason}"`);
    if (answer.rejection) console.log(`  rejected: ${answer.rejection}`);
  }
  console.log(`\n${approvals} of ${CASES.length} approved. ${meter.summary()}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
