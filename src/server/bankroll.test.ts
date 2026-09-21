import { describe, expect, it } from "vitest";
import { BankrollCache } from "./bankroll";
import { FakeChain } from "./wallets/fake";

const cache = (ttlMs = 5_000) => new BankrollCache({ ttlMs, now: () => 1_000 });

describe("warming the bankroll cache", () => {
  it("reads every wallet in one chain request and serves the rest from the cache", async () => {
    const chain = new FakeChain({ initialBalanceWei: 500n });
    const wallets = [await chain.open("atlas"), await chain.open("blaze"), await chain.open("pot")];
    const c = cache();
    await c.warm(chain, wallets);
    const readsAfterWarm = chain.balanceReads;
    for (const w of wallets) expect(await c.get(w)).toBe(500n);
    // The gets came out of the cache, so the chain was not asked again.
    expect(chain.balanceReads).toBe(readsAfterWarm);
  });

  it("asks the chain for nothing when there are no wallets", async () => {
    const chain = new FakeChain();
    await cache().warm(chain, []);
    expect(chain.balanceReads).toBe(0);
  });

  it("leaves a wallet the chain could not answer for out of the cache", async () => {
    // A missing balance is not a balance of nothing. Caching a zero would let
    // an agent be excluded, or worse included, on a number nobody verified.
    const chain = new FakeChain({ initialBalanceWei: 500n });
    const wallet = await chain.open("atlas");
    const partial = { ...chain, getBalances: async () => ({}) } as unknown as FakeChain;
    const c = cache();
    await c.warm(partial, [wallet]);
    const before = chain.balanceReads;
    expect(await c.get(wallet)).toBe(500n);
    expect(chain.balanceReads).toBeGreaterThan(before);
  });

  it("lets a chain failure surface rather than reporting an unread balance", async () => {
    const chain = new FakeChain({ initialBalanceWei: 500n });
    const wallet = await chain.open("atlas");
    const broken = { ...chain, getBalances: async () => { throw new Error("rpc down"); } } as unknown as FakeChain;
    await expect(cache().warm(broken, [wallet])).rejects.toThrow(/rpc down/);
  });
});
