// The read side: one place that opens the arena file, for both routes.
//
// Deliberately not the server context. A reader needs no wallets, no chain
// calls and no SERV client, and building those to answer a page view would
// open every wallet on every request.

import { readEnv } from "../env";
import { ArenaStore, arenaFile, type ArenaState } from "./state";

let store: ArenaStore | undefined;
let network = "";
let kind = "";

/** The store, built once, rereading the file whenever the worker writes it. */
export function arenaReader(): { state: () => ArenaState; chain: { network: string; kind: string } } {
  if (!store) {
    const env = readEnv();
    // The network a reader is on is the one the environment selects, the same
    // way every store in this process is named.
    network = env.viem ? "base-sepolia" : "fake";
    kind = env.viem ? "viem" : "fake";
    store = new ArenaStore(arenaFile(env.dataDir, network), network);
  }
  const held = store;
  return { state: () => held.read(), chain: { network, kind } };
}
