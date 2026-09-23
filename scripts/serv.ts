// The reasoning switches, from a terminal.
//
//   npm run serv -- status
//   npm run serv -- off                agents and the lender answer deterministically
//   npm run serv -- on                 agents and the lender may reason again
//   npm run serv -- scheduled on       rounds the interval starts reason too
//   npm run serv -- scheduled off      only rounds somebody pulled reason
//
// It writes files in the data directory and nothing else. Every process that
// plans a round reads them at the start of every round, so a flip here is
// picked up without restarting the worker or the site.
//
// The key is never read, printed or changed here. Turning reasoning off is
// not a credential operation, and an operator saving credits should not have
// to touch .env.local to do it.

import { join } from "node:path";
import { SERV_OFF_FILE, SERV_SCHEDULED_FILE } from "../src/config/serv";
import { readEnv } from "../src/server/env";
import { scheduledReasoningOn, servReasoningOn, setScheduledReasoning, setServReasoning } from "../src/server/serv/switch";
import { loadLocalEnv } from "./lib/loadEnv";

type Action = "on" | "off" | "status" | "scheduled on" | "scheduled off" | "scheduled status";

function actionFrom(argv: readonly string[]): Action {
  const raw = argv[2]?.trim().toLowerCase();
  const second = argv[3]?.trim().toLowerCase();
  if (raw === undefined || raw === "status") return "status";
  if (raw === "on" || raw === "off") return raw;
  if (raw === "scheduled") {
    if (second === undefined || second === "status") return "scheduled status";
    if (second === "on" || second === "off") return `scheduled ${second}` as Action;
    throw new RangeError(`unknown setting ${second}. Use: npm run serv -- scheduled on|off|status.`);
  }
  throw new RangeError(`unknown command ${raw}. Use on, off, status, or scheduled on|off|status.`);
}

function main(): void {
  loadLocalEnv();
  const env = readEnv();
  const file = join(env.dataDir, SERV_OFF_FILE);
  const scheduledFile = join(env.dataDir, SERV_SCHEDULED_FILE);
  const action = actionFrom(process.argv);

  if (action.startsWith("scheduled")) {
    const on = action === "scheduled status" ? scheduledReasoningOn(scheduledFile) : setScheduledReasoning(scheduledFile, action === "scheduled on");
    console.log(
      on
        ? "Scheduled rounds REASON. Every round the interval starts spends credit."
        : "Scheduled rounds run on INSTINCT. Only a round somebody pulled reasons.",
    );
    if (on && !servReasoningOn(file)) console.log("SERV reasoning is off, which is the master switch, so nothing reasons until it is on.");
    console.log(`setting file: ${scheduledFile}`);
    console.log(`it takes effect on the next round, in every process, with no restart.`);
    return;
  }

  const on = action === "status" ? servReasoningOn(file) : setServReasoning(file, action === "on");
  const keyed = Boolean(env.serv);

  console.log(on ? "SERV reasoning is ON. A round somebody pulls reasons." : "SERV reasoning is OFF. Agents run on instinct and Marrow uses the deterministic lender.");
  if (on) console.log(scheduledReasoningOn(scheduledFile) ? "Scheduled rounds reason as well." : "Scheduled rounds run on instinct, which is the default. Change it with: npm run serv -- scheduled on");
  if (on && !keyed) console.log("No SERV_API_KEY is configured, so rounds will fall back to instinct anyway.");
  console.log(`switch file: ${file}`);
  console.log(`it takes effect on the next round, in every process, with no restart.`);
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
