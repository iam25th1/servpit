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
import { RolloverStore } from "./round/rollover";
import { DebtStore } from "./round/debt";
import { WreckStore } from "./round/wrecks";
import { RoundStore } from "./round/store";
import type { FlowContext } from "./round/types";
import { CostMeter } from "./serv/meter";
import { openWallets, type Wallets } from "./wallets/open";
import { BANK_WALLET_ID, OPERATOR_WALLET_ID } from "@/config/wallets";
import { bankEnabled } from "@/config/economy";
import { WalletRegistry } from "./wallets/registry";
import { getChain } from "./chain";
import type { Chain } from "./wallets/types";
import { DEFAULT_SERV } from "@/config/serv";
import { assertBankShareIsPayable } from "@/config/economy";

export interface SettleContext {
  chain: Chain;
  wallets: Wallets;
  flow: FlowContext;
}

let pending: Promise<SettleContext> | undefined;

async function build(): Promise<SettleContext> {
  const env = readEnv();
  const chain: Chain = getChain(env);
  log.info("wallet backend", { backend: chain.kind, network: chain.network });
  const registry = new WalletRegistry(join(env.dataDir, `wallets-${chain.network}.json`), chain.network);
  // Only when the bank is on and there is a key for it. A round that never
  // asks the bank for anything must not need a wallet it does not have.
  const hasKey = (id: string): boolean => chain.kind === "fake" || Boolean(env.viem?.keys[id]);
  const wallets = await openWallets(chain, registry, {
    bank: bankEnabled() && hasKey(BANK_WALLET_ID),
    operator: bankEnabled() && hasKey(OPERATOR_WALLET_ID),
  });
  const bankroll = new BankrollCache({ ttlMs: 5_000, now: () => Date.now() });
  const ledger = new TransferLedger(join(env.dataDir, `ledger-${chain.network}.json`), chain.network);
  const store = new RoundStore(join(env.dataDir, `rounds-${chain.network}.json`), chain.network);
  const meter = new CostMeter(DEFAULT_SERV.pricing);
  const plans = new PlanStore(join(env.dataDir, `plans-${chain.network}.json`), {}, chain.network);
  const rollover = new RolloverStore(join(env.dataDir, `rollover-${chain.network}.json`), chain.network);
  const debts = new DebtStore(join(env.dataDir, `debts-${chain.network}.json`), chain.network);
  const wreckStore = new WreckStore(join(env.dataDir, `wrecks-${chain.network}.json`), chain.network);
  // A bank wallet exists now, and nothing sends it a share of a house win.
  // This is the path that settles, so it is the path that must refuse to
  // start while a share is set with no transfer behind it.
  assertBankShareIsPayable(false);
  // No serv: a settle has nothing to ask.
  const flow: FlowContext = { chain, wallets, ledger, store, bankroll, meter, plans, rollover, debts, wreckStore, settleLockFile: join(env.dataDir, `settle-${chain.network}.lock`), entrants: 24 };
  return { chain, wallets, flow };
}

export function getSettleContext(): Promise<SettleContext> {
  pending ??= build().catch((e) => {
    pending = undefined;
    throw e;
  });
  return pending;
}
