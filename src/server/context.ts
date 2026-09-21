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
import { PlanStore } from "./round/planStore";
import { RolloverStore } from "./round/rollover";
import { DebtStore } from "./round/debt";
import { WreckStore } from "./round/wrecks";
import { assertBankShareIsPayable } from "@/config/economy";
import { ViemChain } from "./wallets/viem";
import { FakeChain } from "./wallets/fake";
import { openWallets, type Wallets } from "./wallets/open";
import { BANK_WALLET_ID, OPERATOR_WALLET_ID } from "@/config/wallets";
import { bankEnabled } from "@/config/economy";
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
  const chain: Chain = env.viem ? new ViemChain(env.viem) : new FakeChain({ initialBalanceWei: FAKE_INITIAL_WEI });
  log.info("wallet backend", { backend: chain.kind, network: chain.network });
  const registry = new WalletRegistry(join(env.dataDir, `wallets-${chain.network}.json`));
  // Only when the bank is on and there is a key for it. A round that never
  // asks the bank for anything must not need a wallet it does not have.
  const hasKey = (id: string): boolean => chain.kind === "fake" || Boolean(env.viem?.keys[id]);
  const wallets = await openWallets(chain, registry, {
    bank: bankEnabled() && hasKey(BANK_WALLET_ID),
    operator: bankEnabled() && hasKey(OPERATOR_WALLET_ID),
  });
  const bankroll = new BankrollCache({ ttlMs: 5_000, now: () => Date.now() });
  const ledger = new TransferLedger(join(env.dataDir, `ledger-${chain.network}.json`));
  const store = new RoundStore(join(env.dataDir, `rounds-${chain.network}.json`));
  const meter = new CostMeter(DEFAULT_SERV.pricing);
  // Quoted plans, persisted. A settle reads one and never makes one.
  const plans = new PlanStore(join(env.dataDir, `plans-${chain.network}.json`));
  const rollover = new RolloverStore(join(env.dataDir, `rollover-${chain.network}.json`));
  const debts = new DebtStore(join(env.dataDir, `debts-${chain.network}.json`));
  const wreckStore = new WreckStore(join(env.dataDir, `wrecks-${chain.network}.json`));
  // There is no bank wallet in this build, so a nonzero share has nowhere to
  // go. Fail here rather than quietly rolling it over.
  assertBankShareIsPayable(false);
  const servConfig = { ...DEFAULT_SERV, model: env.serv?.model ?? DEFAULT_SERV.model };
  const serv = env.serv ? new ServClient(servConfig, createServTransport(env.serv.apiKey, servConfig)) : undefined;
  log.info("serv backend", { configured: Boolean(serv), model: serv ? servConfig.model : null });
  const flow: FlowContext = { chain, wallets, ledger, store, bankroll, meter, serv, plans, rollover, debts, wreckStore, entrants: 24 };
  return { env, chain, registry, wallets, bankroll, flow };
}

export function getServerContext(): Promise<ServerContext> {
  pending ??= build().catch((e) => {
    pending = undefined;
    throw e;
  });
  return pending;
}
