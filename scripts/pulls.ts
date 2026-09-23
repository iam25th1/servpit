// The lever's limits, from a terminal.
//
//   npm run pulls -- status
//   npm run pulls -- per-identity 5          five pulls per browser per window
//   npm run pulls -- per-identity unlimited  no limit per browser at all
//   npm run pulls -- window 6                how long that window is, in hours
//   npm run pulls -- budget 25               what reasoning may cost in a day, in cents
//   npm run pulls -- per-hour 6              rounds the lever may start in an hour
//
// It writes one file in the data directory and nothing else. The site reads
// that file per request and the worker reads it per round, so a limit changed
// here is in force on the next ask without restarting either of them.
//
// These numbers are what stands between a public button and the operator's
// account, which is why they are set from a machine and never over HTTP.

import { join } from "node:path";
import { pullFile, pullSettingsFile, HOUR_MS } from "../src/config/pulls";
import { SERV_OFF_FILE, SERV_SCHEDULED_FILE } from "../src/config/serv";
import { readEnv } from "../src/server/env";
import { RoundStore } from "../src/server/round/store";
import { scheduledReasoningOn, servReasoningOn } from "../src/server/serv/switch";
import { budgetState } from "../src/server/pulls/budget";
import { parsePullCommand, pullStatusLines } from "../src/server/pulls/command";
import { PullStore } from "../src/server/pulls/log";
import { readPullSettings, writePullSettings } from "../src/server/pulls/settings";
import { loadLocalEnv } from "./lib/loadEnv";

function main(): void {
  loadLocalEnv();
  const env = readEnv();
  const network = env.viem ? "base-sepolia" : "fake";
  const file = pullSettingsFile(env.dataDir);
  const command = parsePullCommand(process.argv.slice(2));

  const settings = command.kind === "set" ? writePullSettings(file, { ...readPullSettings(file), ...command.settings }) : readPullSettings(file);

  const rounds = new RoundStore(join(env.dataDir, `rounds-${network}.json`), network);
  const log = new PullStore(pullFile(env.dataDir, network), network);
  const now = Date.now();

  for (const line of pullStatusLines({
    settings,
    budget: budgetState(rounds.all(), settings.dailyBudgetCents, now),
    startedThisHour: log.takenSince(now - HOUR_MS),
    reasoningOn: servReasoningOn(join(env.dataDir, SERV_OFF_FILE)),
    scheduledReasoning: scheduledReasoningOn(join(env.dataDir, SERV_SCHEDULED_FILE)),
    pendingHandle: log.pending()?.handle ?? null,
  })) {
    console.log(line);
  }
  console.log(`settings file: ${file}`);
  console.log(`it takes effect on the next ask, in every process, with no restart.`);
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
