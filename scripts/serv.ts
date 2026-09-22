// The reasoning switch, from a terminal.
//
//   npm run serv -- status
//   npm run serv -- off      agents and the lender answer deterministically
//   npm run serv -- on       agents and the lender reason again
//
// It writes one file in the data directory and nothing else. Every process
// that plans a round reads that file at the start of every round, so a flip
// here is picked up without restarting the worker or the site.
//
// The key is never read, printed or changed here. Turning reasoning off is
// not a credential operation, and an operator saving credits should not have
// to touch .env.local to do it.

import { join } from "node:path";
import { SERV_OFF_FILE } from "../src/config/serv";
import { readEnv } from "../src/server/env";
import { servReasoningOn, setServReasoning } from "../src/server/serv/switch";
import { loadLocalEnv } from "./lib/loadEnv";

type Action = "on" | "off" | "status";

function actionFrom(argv: readonly string[]): Action {
  const raw = argv[2]?.trim().toLowerCase();
  if (raw === undefined || raw === "status") return "status";
  if (raw === "on" || raw === "off") return raw;
  throw new RangeError(`unknown command ${raw}. Use on, off or status.`);
}

function main(): void {
  loadLocalEnv();
  const env = readEnv();
  const file = join(env.dataDir, SERV_OFF_FILE);
  const action = actionFrom(process.argv);

  const on = action === "status" ? servReasoningOn(file) : setServReasoning(file, action === "on");
  const keyed = Boolean(env.serv);

  console.log(on ? "SERV reasoning is ON. Agents and Marrow reason for every round." : "SERV reasoning is OFF. Agents run on instinct and Marrow uses the deterministic lender.");
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
