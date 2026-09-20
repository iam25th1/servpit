// Lazily built server context shared by route handlers and the CLI.

import { join } from "node:path";
import { BankrollCache } from "./bankroll";
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
  return { env, chain, registry, wallets, bankroll };
}

export function getServerContext(): Promise<ServerContext> {
  pending ??= build().catch((e) => {
    pending = undefined;
    throw e;
  });
  return pending;
}
