// Everything the trailer says, and where each piece of it came from.
//
// Nothing on screen is typed anywhere but here, so this file is the whole
// claim the trailer makes. Figures are as given, not rounded up: the operator's
// run figures are from npm run stats against the live store, the SERV call
// count and spend are from the SERV console rather than the game's books, and
// the quotes and hashes are the live Base Sepolia rounds in docs/bank-live.md
// and the live pit status of round r-4e64201bca4d6458.

/** A Base Sepolia transaction, as a full explorer link so the hash is a public record. */
export interface Hash {
  url: string;
  what: string;
  round: string;
}

/** The fight on screen. Replayed from its seed; see extract.ts and round.json. */
export const FIGHT = {
  caption: "a real round, replayed from its seed by the game's own resolver and renderer",
};

/** Agents deciding over SERV, live round r-4e64201bca4d6458 (npm run pit:status). */
export const AGENT_LINES = [
  { name: "Vex", face: "NinjaFire", line: "Fresh start, I am taking the max and pushing hard.", said: "IN, the maximum stake", round: "r-4e64201bca4d6458" },
  { name: "Rime", face: "Eskimo", line: "Pool is thin for the risk, I'll wait.", said: "OUT, holding 108 chips", round: "r-4e64201bca4d6458" },
];

/** Marrow, the lender, over SERV. docs/bank-live.md. */
export const MARROW_LINES = [
  { line: "No track record here, and I don't lend to ghosts.", said: "REFUSED", round: "go live run, Base Sepolia" },
  { line: "One win in twenty-five rounds earns a shot, but the price is steep.", said: "LENT 19 CHIPS AT 2500 BPS", round: "r-661405385c843da8" },
];

/** Real transactions. docs/bank-live.md. */
export const HASHES: Hash[] = [
  { url: "https://sepolia.basescan.org/tx/0x28dd1266c4dd69de324dac1ed3c9df10d25daf31982c600e6229ccee69fbd9ed", what: "Marrow lends Flint 19 chips", round: "r-661405385c843da8" },
  { url: "https://sepolia.basescan.org/tx/0xa3aba6edde9adbfbf51e59e04f3f71a297c14f3d15083d87428e158bc537c36b", what: "Flint wins, repays 19 out of the pot", round: "r-4f99838371ef97f6" },
  { url: "https://sepolia.basescan.org/tx/0x5ad08460481cb9473aa7fb2d10c6c34b589b998d49563c5cc8865b2f42a43639", what: "The operator seats Vex with 100 chips", round: "r-661405385c843da8" },
];

/** Settlement, as ordinary as it is. */
export const SETTLE = {
  // npm run pit:status, live round r-4e64201bca4d6458: settling phase.
  transfers: "6",
  seconds: "14.8 seconds",
  settleRound: "r-4e64201bca4d6458",
  // src/server/reconcile.ts: on the first settled round on Base Sepolia a
  // wallet moved -132252136528 wei against an expected -100, and the
  // difference was the fee to the wei: 132252136428 wei, from its receipt.
  gasWei: "132252136428",
  gasEth: "0.000000132252136428 ETH",
  network: "Base Sepolia testnet",
};

/**
 * npm run stats against the live store, read 2026-10-05T06:54:08Z, except
 * where marked: the SERV call count and spend are from the SERV console,
 * which the game's books cannot see, and the rest are the operator's own.
 */
export const RUN = {
  rounds: "4,401", // at least: a round that left no trace cannot be counted
  span: "14.2 days", // 2026-09-21 to 2026-10-05, every store that keeps a round id
  transactions: "6,491",
  settledRounds: "3,784",
  chips: "124,146",
  paidOut: "60,288",
  gas: "0.000946 ETH",
  biggestPot: "310",
  biggestPayout: "1,120",
  reconciled: "200 of 200",
  loans: "108",
  lent: "1,115",
  writtenOff: "1,136",
  wrecked: "13,571",
  cupcakeWins: "131",
  cupcakeRounds: "3,153",
  cupcakeKills: "3,038",
  cupcakeRun: "9",
  claimedKills: "4,402",
  claimedFighters: "3",
  handles: "14",
  fullCalls: "35",
  fullCallsRight: "17",
  reasoned: "3",
  leverStarted: "17",
  // SERV console, as given by the operator.
  servCalls: "1,012",
  servSpend: "$4.33",
  perRound: "$0.0209",
  // As given by the operator.
  failedInARow: "18",
  roundsDropped: "0",
  spectators: "1,000",
  fightersPerRound: "24",
  // npm test on this branch.
  tests: "1,724",
};

/** Timings as measured, as given. */
export const MEASURED = ["Prompt Guard 2.9s", "Shadow Agent 3.4s", "Multipath free"];

/** Measured distribution, as given. */
export const ODDS = {
  common: "2.8 to 3.7%",
  uncommon: "4.0 to 5.5%",
  rare: "10.5 to 14.6%",
  triple: "32.1%",
  baseline: "4.17%",
  split: "70/25/5",
  tripleShare: "0.65%",
  ticks: "37",
  seconds: "about 11.85 seconds",
};

export const END = { url: "servpit.25th.dev" };
