// Opens (or creates and persists) one wallet per named agent plus the pot.

import { NAMED_AGENTS, POT_WALLET_ID } from "@/config/agents";
import { log } from "../log";
import type { WalletRegistry } from "./registry";
import type { Chain, Wallet } from "./types";

export interface Wallets {
  agents: Map<string, Wallet>;
  pot: Wallet;
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

export async function openWallets(chain: Chain, registry: WalletRegistry): Promise<Wallets> {
  const agents = new Map<string, Wallet>();
  for (const profile of NAMED_AGENTS) agents.set(profile.id, await openOne(chain, registry, profile.id));
  const pot = await openOne(chain, registry, POT_WALLET_ID);
  return { agents, pot };
}
