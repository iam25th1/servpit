// One chain per process.
//
// Both contexts used to build their own. The plan route builds the server
// context and the run route builds the settle context, because the settle
// path may not import anything that can reach a model, and each of them ran
// `new FakeChain(...)`. On the real backend that is harmless, because both
// were talking to Base Sepolia and the chain itself is the shared state. On
// the fake backend the chain IS the state: balances live in a Map inside the
// instance. Two instances meant the route that plans read balances that no
// settle had ever touched, so it kept admitting agents on the opening figure
// while the settle path knew they had been drained. It showed up as a round
// dying on "insufficient balance" for an agent the lineup had just shown as
// good for its seat.
//
// Kept here rather than in either context so neither owns it, and so the
// import graph the settle isolation walk checks gains no new edges: this
// imports the two chain backends and nothing else.

import { readEnv, type ServerEnv } from "./env";
import { weiPerChip } from "@/config/stake";
import { FakeChain } from "./wallets/fake";
import { ViemChain } from "./wallets/viem";
import type { Chain } from "./wallets/types";

/**
 * Fake chain wallets start with a testnet sized float so local rounds can run.
 *
 * SERVPIT_FAKE_BALANCE_CHIPS lowers it, which is the only way to see an agent
 * short of a seat without touching a real wallet. It does nothing on the viem
 * backend, where balances come from the chain.
 */
const FAKE_INITIAL_WEI = 1_000_000_000_000_000n;

export function fakeOpeningWei(env: NodeJS.ProcessEnv = process.env): bigint {
  const raw = env.SERVPIT_FAKE_BALANCE_CHIPS?.trim();
  if (raw === undefined || raw.length === 0) return FAKE_INITIAL_WEI;
  const chips = Number(raw);
  if (!Number.isInteger(chips) || chips < 0) throw new RangeError(`SERVPIT_FAKE_BALANCE_CHIPS must be a whole number of chips, got ${raw}`);
  return BigInt(chips) * weiPerChip(env);
}

let shared: Chain | undefined;

/** The process's chain, built once. */
export function getChain(env: ServerEnv = readEnv()): Chain {
  shared ??= env.viem ? new ViemChain(env.viem) : new FakeChain({ initialBalanceWei: fakeOpeningWei(process.env) });
  return shared;
}
