// The context a settle is allowed to see.
//
// Everything a round needs to collect entries, resolve the fight, pay out and
// reconcile, and deliberately nothing that can reach a model. The settle path
// may not import the SERV client or anything that decides, which a guard test
// enforces by walking the import graph from the settle route.
//
// It shares the same singletons as the full context, so the plan written by
// one request is the plan the next one settles.

import { join } from "node:path";
import { BankrollCache } from "./bankroll";
import { readEnv } from "./env";
import { TransferLedger } from "./ledger";
import { log } from "./log";
import { PlanStore } from "./round/planStore";
import { RoundStore } from "./round/store";
import type { FlowContext } from "./round/types";
import { CostMeter } from "./serv/meter";
import { FakeChain } from "./wallets/fake";
import { openWallets, type Wallets } from "./wallets/open";
import { WalletRegistry } from "./wallets/registry";
import type { Chain } from "./wallets/types";
import { ViemChain } from "./wallets/viem";
import { DEFAULT_SERV } from "@/config/serv";

export interface SettleContext {
  chain: Chain;
  wallets: Wallets;
  flow: FlowContext;
}

/** Fake chain wallets start with a testnet sized float so local rounds can run. */
const FAKE_INITIAL_WEI = 1_000_000_000_000_000n;

let pending: Promise<SettleContext> | undefined;

async function build(): Promise<SettleContext> {
  const env = readEnv();
  const chain: Chain = env.viem ? new ViemChain(env.viem) : new FakeChain({ initialBalanceWei: FAKE_INITIAL_WEI });
  log.info("wallet backend", { backend: chain.kind, network: chain.network });
  const registry = new WalletRegistry(join(env.dataDir, `wallets-${chain.network}.json`));
  const wallets = await openWallets(chain, registry);
  const bankroll = new BankrollCache({ ttlMs: 5_000, now: () => Date.now() });
  const ledger = new TransferLedger(join(env.dataDir, `ledger-${chain.network}.json`));
  const store = new RoundStore(join(env.dataDir, `rounds-${chain.network}.json`));
  const meter = new CostMeter(DEFAULT_SERV.pricing);
  const plans = new PlanStore(join(env.dataDir, `plans-${chain.network}.json`));
  // No serv: a settle has nothing to ask.
  const flow: FlowContext = { chain, wallets, ledger, store, bankroll, meter, plans, entrants: 24 };
  return { chain, wallets, flow };
}

export function getSettleContext(): Promise<SettleContext> {
  pending ??= build().catch((e) => {
    pending = undefined;
    throw e;
  });
  return pending;
}
