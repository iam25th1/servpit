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

/** The operator's figures, as given. SERV console where marked. */
export const RUN = {
  rounds: "2,300",
  transfers: "2,231",
  chips: "84,666",
  servCalls: "1,012",
  servSpend: "$4.33",
  perRound: "$0.0209",
  tests: "1,701",
  failedInARow: "18",
  roundsDropped: "0",
  survived: "1,440",
  wins: "55",
  kills: "2,681",
  claimedFighters: "3",
  wrecked: "3,969",
  spectators: "1,000",
  days: "9.8",
  reconFailures: "99",
  reconReal: "0",
  fightersPerRound: "24",
  reasonedProven: "3",
  reasonedPulled: "17",
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
