// Fills the permanent round summary from every store that survives.
//
//   npm run backfill-summaries                the live network
//   npm run backfill-summaries -- fake        a local one
//   npm run backfill-summaries -- --dry       say what it would write
//
// The round store keeps the last two hundred rounds, so most of the pit's life
// exists only as traces: a transfer with a round id, a wreck, a pick, a pull, a
// quoted plan. This walks those, writes one permanent line per round it can
// name, and marks every line it writes as backfilled.
//
// What it cannot know it leaves null. A round the ledger only remembers by id
// gets an id, a date and nothing else, because a winner nobody recorded is not
// a winner this script gets to choose. It never rewrites a line the settle
// wrote, and running it twice adds nothing the second time.

import { classSplit, lifetimeRounds } from "../src/server/stats/history";
import { LIVE_NETWORK, dataDirFrom, loadStores, type RoundRow } from "../src/server/stats/read";
import { SummaryStore, summaryFile, type RoundSummary } from "../src/server/round/summaries";
import { loadLocalEnv } from "./lib/loadEnv";

function main(): void {
  loadLocalEnv();
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const network = args.find((a) => !a.startsWith("-")) ?? LIVE_NETWORK;
  const dataDir = dataDirFrom();
  const stores = loadStores(dataDir, network);
  if (stores.rounds === null && stores.transfers === null) {
    console.error(`no stores for ${network} in ${dataDir}. Give the network as an argument, or set SERVPIT_DATA_DIR.`);
    process.exitCode = 1;
    return;
  }

  const life = lifetimeRounds(stores);
  const inWindow = new Map<string, RoundRow>((stores.rounds ?? []).map((r) => [r.roundId, r]));
  const store = new SummaryStore(summaryFile(dataDir, network), network);

  let written = 0;
  let already = 0;
  const unknown = { at: 0, winner: 0, cost: 0, answers: 0 };

  for (const roundId of [...life.ids].sort((a, b) => (life.dated.get(a) ?? 0) - (life.dated.get(b) ?? 0))) {
    if (store.has(roundId)) {
      already += 1;
      continue;
    }
    const full = inWindow.get(roundId);
    const at = life.dated.get(roundId);
    // A round whose cost is its own carries the tokens. One stored before that
    // carries the meter's running total, which is not this round's spend, so it
    // is left unknown rather than copied in as though it were.
    const ownCost = full?.servTokensIn !== undefined || full?.servTokensOut !== undefined;
    const summary: RoundSummary = {
      roundId,
      at: at === undefined ? null : new Date(at).toISOString(),
      entrants: full?.entrants ?? null,
      winner: full?.winner ?? null,
      potWei: full?.potWei ?? null,
      answers: life.classified.get(roundId) ?? null,
      servCalls: full?.servCalls ?? null,
      servMicroCents: ownCost ? (full?.servMicroCents ?? null) : null,
      tokensIn: full?.servTokensIn ?? null,
      tokensOut: full?.servTokensOut ?? null,
      reconciled: full?.reconciled ?? null,
      backfilled: true,
    };
    if (summary.at === null) unknown.at += 1;
    if (summary.winner === null) unknown.winner += 1;
    if (summary.servMicroCents === null) unknown.cost += 1;
    if (summary.answers === null) unknown.answers += 1;
    if (!dry) store.append(summary);
    written += 1;
  }

  const split = classSplit(life);
  console.log(`${dry ? "would write" : "wrote"} ${written.toLocaleString("en-US")} rounds, ${already.toLocaleString("en-US")} already had a line`);
  console.log(`  left unknown: ${unknown.at.toLocaleString("en-US")} with no date, ${unknown.winner.toLocaleString("en-US")} with no winner, ${unknown.cost.toLocaleString("en-US")} with no cost of their own, ${unknown.answers.toLocaleString("en-US")} nobody can class`);
  console.log(`  of everything on file: ${split.reasoned} reasoned, ${split.learned} learned, ${split.instinct} on instinct, ${split.unclassified.toLocaleString("en-US")} unclassified`);
  console.log(`  ${dry ? "nothing was written" : `written to ${summaryFile(dataDir, network)}`}`);
}

main();
