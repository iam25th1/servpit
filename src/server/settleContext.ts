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
import { weiPerChip } from "@/config/stake";
import { TransferLedger } from "./ledger";
import { log } from "./log";
import { PlanStore } from "./round/planStore";
import { RolloverStore } from "./round/rollover";
import { DebtStore } from "./round/debt";
import { WreckStore } from "./round/wrecks";
import { RoundStore } from "./round/store";
import type { FlowContext } from "./round/types";
import { CostMeter } from "./serv/meter";
import { FakeChain } from "./wallets/fake";
import { openWallets, type Wallets } from "./wallets/open";
import { BANK_WALLET_ID, OPERATOR_WALLET_ID } from "@/config/wallets";
import { bankEnabled } from "@/config/economy";
import { WalletRegistry } from "./wallets/registry";
import type { Chain } from "./wallets/types";
import { ViemChain } from "./wallets/viem";
import { DEFAULT_SERV } from "@/config/serv";
import { assertBankShareIsPayable } from "@/config/economy";

export interface SettleContext {
  chain: Chain;
  wallets: Wallets;
  flow: FlowContext;
}

/**
 * Fake chain wallets start with a testnet sized float so local rounds can run.
 *
 * SERVPIT_FAKE_BALANCE_CHIPS lowers it, which is the only way to see an agent
 * short of a seat without touching a real wallet. It does nothing on the viem
 * backend, where balances come from the chain.
 */
const FAKE_INITIAL_WEI = 1_000_000_000_000_000n;

function fakeOpeningWei(env: NodeJS.ProcessEnv): bigint {
  const raw = env.SERVPIT_FAKE_BALANCE_CHIPS?.trim();
  if (raw === undefined || raw.length === 0) return FAKE_INITIAL_WEI;
  const chips = Number(raw);
  if (!Number.isInteger(chips) || chips < 0) throw new RangeError(`SERVPIT_FAKE_BALANCE_CHIPS must be a whole number of chips, got ${raw}`);
  return BigInt(chips) * weiPerChip(env);
}

let pending: Promise<SettleContext> | undefined;

async function build(): Promise<SettleContext> {
  const env = readEnv();
  const chain: Chain = env.viem ? new ViemChain(env.viem) : new FakeChain({ initialBalanceWei: fakeOpeningWei(process.env) });
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
  // No bank wallet in this build, so a nonzero share has nowhere to go. This
  // is the path that settles, so it is the path that must refuse to start.
  assertBankShareIsPayable(false);
  // No serv: a settle has nothing to ask.
  const flow: FlowContext = { chain, wallets, ledger, store, bankroll, meter, plans, rollover, debts, wreckStore, entrants: 24 };
  return { chain, wallets, flow };
}

export function getSettleContext(): Promise<SettleContext> {
  pending ??= build().catch((e) => {
    pending = undefined;
    throw e;
  });
  return pending;
}
