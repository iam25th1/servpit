// Compacts the graveyard once, after the empty bank loop.
//
//   npm run compact-graveyard                   the live network, for real
//   npm run compact-graveyard -- --dry          say what it would do, write nothing
//   npm run compact-graveyard -- --keep-churn   only rotate and compress
//   npm run compact-graveyard -- fake           another network
//   npm run compact-graveyard -- --force        even if the old file is fresh
//
// Reads the old single graveyard file, takes out the rows the empty bank loop
// wrote when each row proves it is one, writes what is left as one compressed
// file in the new format, and renames the old file to a backup beside it
// without changing a byte of it. Then sets aside and compresses the active
// file, if there is one. Prints every file's size before and after.
//
// Run it with the new build deployed, so nothing is still rewriting the old
// file. It refuses an old file written in the last ten minutes for that
// reason. The rule for what counts as churn is in compactGraveyard.ts.

import { join } from "node:path";
import { graveyardOptions } from "../src/config/graveyard";
import { compactGraveyard, type FileSize } from "../src/server/round/compactGraveyard";
import { LIVE_NETWORK, dataDirFrom } from "../src/server/stats/read";
import { loadLocalEnv } from "./lib/loadEnv";

const bytes = (n: number): string => n.toLocaleString("en-US");

function table(title: string, files: FileSize[]): void {
  console.log(title);
  if (files.length === 0) console.log("  (nothing)");
  for (const f of files) console.log(`  ${f.file.padEnd(72)} ${bytes(f.bytes).padStart(14)} bytes ${bytes(f.rows).padStart(9)} rows`);
  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  console.log(`  ${"total read by the pit".padEnd(72)} ${bytes(total).padStart(14)} bytes`);
}

function main(): void {
  loadLocalEnv();
  const args = process.argv.slice(2);
  const network = args.find((a) => !a.startsWith("-")) ?? LIVE_NETWORK;
  const dataDir = dataDirFrom();
  const file = join(dataDir, `wrecks-${network}.json`);
  const report = compactGraveyard({
    file,
    network,
    graveyard: graveyardOptions(),
    dryRun: args.includes("--dry"),
    keepChurn: args.includes("--keep-churn"),
    force: args.includes("--force"),
  });

  console.log(`graveyard for ${network} in ${dataDir}${report.dryRun ? ", dry run: nothing written" : ""}`);
  table("before", report.before);
  if (report.dryRun) {
    console.log(`would keep ${bytes(report.rowsKept)} of ${bytes(report.rowsBefore)} rows and take out ${bytes(report.churnRemoved)} empty bank churn rows`);
    return;
  }
  table("after", report.after);
  if (report.backup) {
    console.log(`backup, untouched: ${report.backup.file} (${bytes(report.backup.bytes)} bytes). Delete it yourself once the graveyard reads right.`);
  }
  console.log(
    report.keptChurn
      ? `kept every row: rotated and compressed only. ${bytes(report.rowsKept)} rows.`
      : `kept ${bytes(report.rowsKept)} of ${bytes(report.rowsBefore)} rows, took out ${bytes(report.churnRemoved)} empty bank churn rows.`,
  );
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
