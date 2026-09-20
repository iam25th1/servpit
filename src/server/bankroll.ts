// Bankroll is what the chain says it is. This cache only saves repeated
// reads inside one request; any transfer invalidates it and a short TTL
// bounds staleness. It is never the source of truth.

import type { Wallet } from "./wallets/types";

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

  invalidate(address?: string): void {
    if (address === undefined) this.entries.clear();
    else this.entries.delete(address);
  }
}

export type Eligibility = { eligible: true; balance: bigint } | { eligible: false; balance: bigint; reason: string };

/** A broke agent never enters. Reads the chain through the cache. */
export async function eligibleForEntry(wallet: Wallet, stakeWei: bigint, cache: BankrollCache): Promise<Eligibility> {
  const balance = await cache.get(wallet);
  if (balance < stakeWei) return { eligible: false, balance, reason: `balance ${balance} wei below stake ${stakeWei} wei` };
  return { eligible: true, balance };
}
