// One claims log per process, built the way the pick and pull logs are.
//
// Not the server context: a claim needs no wallets, no chain and no SERV
// client, and building those to append a line would open every wallet on
// every request.

import { fighterFile } from "@/config/fighters";
import { readEnv } from "../env";
import { FighterStore } from "./log";

let store: FighterStore | undefined;

/** The log, built once, rereading the file whenever anybody appends to it. */
export function fighterReader(): FighterStore {
  if (!store) {
    const env = readEnv();
    const network = env.viem ? "base-sepolia" : "fake";
    store = new FighterStore(fighterFile(env.dataDir, network), network);
  }
  return store;
}
