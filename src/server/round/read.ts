// One round history per process, built the way the pick log is built.
//
// Not the server context: counting what the pit has reasoned about needs no
// wallets, no chain and no SERV client, and building those to answer a read
// would open every wallet on every request.

import { join } from "node:path";
import { readEnv } from "../env";
import { RoundStore } from "./store";

let store: RoundStore | undefined;

/** The history, built once, rereading the file whenever the worker writes it. */
export function roundReader(): RoundStore {
  if (!store) {
    const env = readEnv();
    const network = env.viem ? "base-sepolia" : "fake";
    store = new RoundStore(join(env.dataDir, `rounds-${network}.json`), network);
  }
  return store;
}

/**
 * How many reasoned decisions the pit has on file with the spot they were
 * made in, which is what the learner can actually read.
 *
 * Rounds stored before the pit started recording the spot are not counted,
 * because they cannot be learned from.
 */
export function reasonedOnFile(rounds: RoundStore): { decisions: number; rounds: number } {
  let decisions = 0;
  let counted = 0;
  for (const round of rounds.all()) {
    const learnable = round.agents.filter((a) => a.source === "serv" && a.situation).length;
    if (learnable === 0) continue;
    counted += 1;
    decisions += learnable;
  }
  return { decisions, rounds: counted };
}
