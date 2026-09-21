// Bankroll is what the chain says it is. This cache only saves repeated
// reads inside one request; any transfer invalidates it and a short TTL
// bounds staleness. It is never the source of truth.

import type { Chain, Wallet } from "./wallets/types";

export interface BankrollCacheOptions {
  ttlMs: number;
  now: () => number;
}

export class BankrollCache {
  private readonly entries = new Map<string, { balance: bigint; readAt: number }>();

  constructor(private readonly options: BankrollCacheOptions) {}

  async get(wallet: Wallet): Promise<bigint> {
    const hit = this.entries.get(wallet.address);
    const now = this.options.now();
    if (hit && this.options.ttlMs > 0 && now - hit.readAt < this.options.ttlMs) return hit.balance;
    const balance = await wallet.getBalance();
    this.entries.set(wallet.address, { balance, readAt: now });
    return balance;
  }

  /**
   * Fills the cache for several wallets in one chain request.
   *
   * The per wallet get below is what the round actually calls, and it reads
   * the cache first, so warming it turns a round's seven sequential reads
   * into one. A wallet the chain could not answer for is left out, so its get
   * still goes to the chain and still fails honestly rather than reading back
   * a zero balance nobody verified.
   */
  async warm(chain: Chain, wallets: readonly Wallet[]): Promise<void> {
    if (wallets.length === 0) return;
    const balances = await chain.getBalances(wallets.map((w) => w.address));
    const now = this.options.now();
    for (const wallet of wallets) {
      const balance = balances[wallet.address];
      if (balance !== undefined) this.entries.set(wallet.address, { balance, readAt: now });
    }
  }

  invalidate(address?: string): void {
    if (address === undefined) this.entries.clear();
    else this.entries.delete(address);
  }
}

export type Eligibility = { eligible: true; balance: bigint } | { eligible: false; balance: bigint; reason: string };

/**
 * A broke agent never enters, and since gas is no longer sponsored a
 * gas exhausted one is the same case: it cannot cover what the round costs it.
 * Both exclusions go through here, and the balance always comes from the chain.
 */
export async function eligibleForEntry(wallet: Wallet, stakeWei: bigint, cache: BankrollCache, gasReserveWei = 0n): Promise<Eligibility> {
  const balance = await cache.get(wallet);
  const needed = stakeWei + gasReserveWei;
  if (balance < needed) return { eligible: false, balance, reason: `balance ${balance} wei below the ${needed} wei needed` };
  return { eligible: true, balance };
}
