// Opens (or creates and persists) one wallet per named agent plus the pot.

import { NAMED_AGENTS, POT_WALLET_ID } from "@/config/agents";
import { BANK_WALLET_ID } from "@/config/wallets";
import { log } from "../log";
import type { WalletRegistry } from "./registry";
import type { Chain, Wallet } from "./types";

export interface Wallets {
  agents: Map<string, Wallet>;
  pot: Wallet;
  /**
   * The lender, present only when there is a key for it and the bank is on.
   *
   * Optional because the whole bank is optional. Nothing in a round reads it
   * unless SERVPIT_BANK_ENABLED is true, and the seven wallets a round has
   * always needed are unaffected by its absence.
   */
  bank?: Wallet;
}

export interface OpenOptions {
  /** Whether to open the bank's wallet. It needs a key of its own. */
  bank?: boolean;
}

async function openOne(chain: Chain, registry: WalletRegistry, id: string): Promise<Wallet> {
  const known = registry.get(id);
  const address = known && known.network === chain.network ? known.address : undefined;
  const wallet = await chain.open(id, address);
  if (!address) {
    registry.set(id, { address: wallet.address, network: chain.network });
    log.info("wallet created", { id, address: wallet.address, network: chain.network });
  }
  return wallet;
}

export async function openWallets(chain: Chain, registry: WalletRegistry, options: OpenOptions = {}): Promise<Wallets> {
  const agents = new Map<string, Wallet>();
  for (const profile of NAMED_AGENTS) agents.set(profile.id, await openOne(chain, registry, profile.id));
  const pot = await openOne(chain, registry, POT_WALLET_ID);
  const bank = options.bank ? await openOne(chain, registry, BANK_WALLET_ID) : undefined;
  return { agents, pot, ...(bank ? { bank } : {}) };
}
