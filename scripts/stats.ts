// Everything worth posting about the pit, counted from the stores.
//
//   npm run stats                  the live network
//   npm run stats -- fake          a local one
//   SERVPIT_DATA_DIR=... npm run stats
//
// Read only, and structurally so: it opens the store files itself rather than
// through any store class, so there is no code path here that can write a
// line, create a file or take a lock. test/stats-read-only.test.ts runs it
// against a directory with the write bit off and fails if it so much as
// changes a checksum.
//
// It starts no round, pulls no lever and calls no model. It cannot: nothing in
// its import graph reaches a wallet, the settle path or the SERV client, which
// the same test asserts by reading this file's imports.

import { collect } from "../src/server/stats/collect";
import { renderReport } from "../src/server/stats/format";
import { LIVE_NETWORK, dataDirFrom, loadStores } from "../src/server/stats/read";

function main(): void {
  const asked = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const network = asked[0] ?? LIVE_NETWORK;
  const dataDir = dataDirFrom();
  const stores = loadStores(dataDir, network);
  if (stores.rounds === null && stores.transfers === null && stores.arena === null) {
    console.error(`no stores for ${network} in ${dataDir}. Give the network as an argument, or set SERVPIT_DATA_DIR.`);
    process.exitCode = 1;
    return;
  }
  console.log(renderReport(collect(stores)));
}

main();
