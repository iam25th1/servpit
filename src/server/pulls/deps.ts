// Everything the lever needs to answer, built from files rather than from a
// server context.
//
// A pull needs no wallets, no chain and no SERV client. It needs the log, the
// operator's settings, what reasoning has cost today and whether reasoning is
// switched on at all, and every one of those is a file read. Building the
// full context to answer a button would open every wallet on every request.
//
// Nothing is cached: the settings and the switch are read per request on
// purpose, so an operator tightening a limit is heard without a restart.

import { join } from "node:path";
import { pullSettingsFile } from "@/config/pulls";
import { SERV_OFF_FILE } from "@/config/serv";
import { readEnv } from "../env";
import { RoundStore } from "../round/store";
import { servReasoningOn } from "../serv/switch";
import { budgetState, type BudgetState } from "./budget";
import { pullReader } from "./read";
import { readPullSettings, type PullSettings } from "./settings";

let rounds: RoundStore | undefined;

/** The round history, built once and reread whenever the worker writes it. */
function roundStore(dataDir: string, network: string): RoundStore {
  if (!rounds) rounds = new RoundStore(join(dataDir, `rounds-${network}.json`), network);
  return rounds;
}

export interface PullEnvironment {
  settings: PullSettings;
  budget: BudgetState;
  reasoningOn: boolean;
}

/** The operator's limits, and where today's spend stands against them. */
export function pullEnvironment(now: number = Date.now()): PullEnvironment {
  const env = readEnv();
  const network = env.viem ? "base-sepolia" : "fake";
  const settings = readPullSettings(pullSettingsFile(env.dataDir));
  return {
    settings,
    budget: budgetState(roundStore(env.dataDir, network).all(), settings.dailyBudgetCents, now),
    reasoningOn: servReasoningOn(join(env.dataDir, SERV_OFF_FILE)),
  };
}

export { pullReader };
