// Lazily built server context shared by route handlers and the CLI.

import { join } from "node:path";
import { BankrollCache } from "./bankroll";
import { TransferLedger } from "./ledger";
import { DEFAULT_SERV } from "@/config/serv";
import { CostMeter, ServClient } from "./serv/client";
import { createServTransport } from "./serv/transport";
import { RoundStore } from "./round/store";
import type { FlowContext } from "./round/flow";
import { readEnv, type ServerEnv } from "./env";
import { log } from "./log";
import { CdpChain } from "./wallets/cdp";
import { FakeChain } from "./wallets/fake";
import { openWallets, type Wallets } from "./wallets/open";
import { WalletRegistry } from "./wallets/registry";
import type { Chain } from "./wallets/types";

export interface ServerContext {
  env: ServerEnv;
  chain: Chain;
  registry: WalletRegistry;
  wallets: Wallets;
  bankroll: BankrollCache;
  /** Everything the round flow needs. entrants is overridden per request. */
  flow: FlowContext;
}

let pending: Promise<ServerContext> | undefined;

/** Fake chain wallets start with a testnet sized float so local rounds can run. */
const FAKE_INITIAL_WEI = 1_000_000_000_000_000n;

async function build(): Promise<ServerContext> {
  const env = readEnv();
  const chain: Chain = env.cdp ? new CdpChain({ ...env.cdp, networkId: "base-sepolia" }) : new FakeChain({ initialBalanceWei: FAKE_INITIAL_WEI });
  log.info("wallet backend", { backend: chain.kind, network: chain.network });
  const registry = new WalletRegistry(join(env.dataDir, `wallets-${chain.network}.json`));
  const wallets = await openWallets(chain, registry);
  const bankroll = new BankrollCache({ ttlMs: 5_000, now: () => Date.now() });
  const ledger = new TransferLedger(join(env.dataDir, `ledger-${chain.network}.json`));
  const store = new RoundStore(join(env.dataDir, `rounds-${chain.network}.json`));
  const meter = new CostMeter(DEFAULT_SERV.pricing);
  const servConfig = { ...DEFAULT_SERV, model: env.serv?.model ?? DEFAULT_SERV.model };
  const serv = env.serv ? new ServClient(servConfig, createServTransport(env.serv.apiKey, servConfig)) : undefined;
  log.info("serv backend", { configured: Boolean(serv), model: serv ? servConfig.model : null });
  const flow: FlowContext = { chain, wallets, ledger, store, bankroll, meter, serv, entrants: 24 };
  return { env, chain, registry, wallets, bankroll, flow };
}

export function getServerContext(): Promise<ServerContext> {
  pending ??= build().catch((e) => {
    pending = undefined;
    throw e;
  });
  return pending;
}
