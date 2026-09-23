// One pull log per process, built the way the pick log is built.
//
// Not the server context: an ask needs no wallets, no chain and no SERV
// client, and building those to append a line would open every wallet on
// every request.

import { pullFile } from "@/config/pulls";
import { readEnv } from "../env";
import { PullStore } from "./log";

let store: PullStore | undefined;

/** The log, built once, rereading the file whenever anybody appends to it. */
export function pullReader(): PullStore {
  if (!store) {
    const env = readEnv();
    const network = env.viem ? "base-sepolia" : "fake";
    store = new PullStore(pullFile(env.dataDir, network), network);
  }
  return store;
}
