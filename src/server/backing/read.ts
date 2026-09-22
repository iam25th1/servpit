// One pick log per process, built the way the arena reader is built.
//
// Not the server context: a pick needs no wallets, no chain and no SERV
// client, and building those to record a line in a log would open every
// wallet on every request.

import { readEnv } from "../env";
import { PickStore, pickFile } from "./picks";

let store: PickStore | undefined;

/** The log, built once, rereading the file whenever anybody appends to it. */
export function pickReader(): PickStore {
  if (!store) {
    const env = readEnv();
    const network = env.viem ? "base-sepolia" : "fake";
    store = new PickStore(pickFile(env.dataDir, network), network);
  }
  return store;
}
