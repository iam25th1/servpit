import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NAMED_AGENTS, POT_WALLET_ID } from "@/config/agents";
import { BankrollCache } from "../bankroll";
import { FakeChain } from "./fake";
import { WalletRegistry } from "./registry";
import { openWallets } from "./open";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("FakeChain", () => {
  it("creates wallets with deterministic addresses, tracks balances in wei, and applies calls once per idempotency key", async () => {
    const chain = new FakeChain({ initialBalanceWei: 1_000n });
    const a = await chain.open("atlas");
    const b = await chain.open("pot");
    expect(a.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(await a.getBalance()).toBe(1_000n);
    const r1 = await a.send([{ to: b.address, value: 400n }], "key-1");
    const r2 = await a.send([{ to: b.address, value: 400n }], "key-1");
    expect(r1.txHash).toBe(r2.txHash);
    expect(await a.getBalance()).toBe(600n);
    expect(await b.getBalance()).toBe(1_400n);
    expect(chain.applied).toBe(1);
  });

  it("rejects a send the balance cannot cover and never goes negative", async () => {
    const chain = new FakeChain({ initialBalanceWei: 100n });
    const a = await chain.open("atlas");
    const b = await chain.open("pot");
    await expect(a.send([{ to: b.address, value: 101n }], "k")).rejects.toThrow(/insufficient/);
    expect(await a.getBalance()).toBe(100n);
  });

  it("reopens the same address when given it, and a fresh one otherwise", async () => {
    const chain = new FakeChain({ initialBalanceWei: 5n });
    const first = await chain.open("atlas");
    const again = await chain.open("atlas", first.address);
    expect(again.address).toBe(first.address);
    const other = await chain.open("blaze");
    expect(other.address).not.toBe(first.address);
  });
});

describe("WalletRegistry", () => {
  it("persists addresses only and survives a reload", () => {
    dir = mkdtempSync(join(tmpdir(), "servpit-wallets-"));
    const file = join(dir, "wallets.json");
    const reg = new WalletRegistry(file);
    expect(reg.get("atlas")).toBeUndefined();
    reg.set("atlas", { address: "0x" + "1".repeat(40), network: "fake" });
    const raw = readFileSync(file, "utf8");
    expect(raw).toContain("0x1111");
    expect(raw).not.toMatch(/secret|private|seed/i);
    expect(new WalletRegistry(file).get("atlas")?.address).toBe("0x" + "1".repeat(40));
  });

  it("refuses to store anything that is not an address", () => {
    dir = mkdtempSync(join(tmpdir(), "servpit-wallets-"));
    const reg = new WalletRegistry(join(dir, "w.json"));
    expect(() => reg.set("atlas", { address: "0x" + "ab".repeat(32), network: "fake" })).toThrow(/address/);
    expect(() => reg.set("../x", { address: "0x" + "1".repeat(40), network: "fake" })).toThrow(/id/);
  });
});

describe("openWallets", () => {
  it("opens the six named agents plus the pot, persisting each address so identity survives restarts", async () => {
    dir = mkdtempSync(join(tmpdir(), "servpit-wallets-"));
    const registry = new WalletRegistry(join(dir, "wallets.json"));
    const chain = new FakeChain({ initialBalanceWei: 10n });
    const first = await openWallets(chain, registry);
    expect([...first.agents.keys()]).toEqual(NAMED_AGENTS.map((a) => a.id));
    expect(first.pot.address).toBeDefined();
    const second = await openWallets(chain, new WalletRegistry(join(dir, "wallets.json")));
    for (const a of NAMED_AGENTS) expect(second.agents.get(a.id)!.address).toBe(first.agents.get(a.id)!.address);
    expect(second.pot.address).toBe(first.pot.address);
    expect(registry.get(POT_WALLET_ID)?.address).toBe(first.pot.address);
  });
});

describe("BankrollCache", () => {
  it("reads from chain, caches briefly, and invalidation forces a fresh read", async () => {
    const chain = new FakeChain({ initialBalanceWei: 500n });
    const a = await chain.open("atlas");
    const b = await chain.open("pot");
    let now = 0;
    const cache = new BankrollCache({ ttlMs: 1_000, now: () => now });
    expect(await cache.get(a)).toBe(500n);
    await a.send([{ to: b.address, value: 200n }], "k1");
    expect(await cache.get(a)).toBe(500n);
    cache.invalidate(a.address);
    expect(await cache.get(a)).toBe(300n);
    await a.send([{ to: b.address, value: 100n }], "k2");
    now = 2_000;
    expect(await cache.get(a)).toBe(200n);
    expect(chain.balanceReads).toBe(3);
  });
});

describe("broke agents", () => {
  it("are excluded from entry: eligibility reads the chain balance, not local state", async () => {
    const { eligibleForEntry } = await import("../bankroll");
    const chain = new FakeChain({ initialBalanceWei: 99n });
    const broke = await chain.open("atlas");
    const cache = new BankrollCache({ ttlMs: 0, now: () => 0 });
    expect(await eligibleForEntry(broke, 100n, cache)).toEqual({ eligible: false, balance: 99n, reason: "balance 99 wei below the 100 wei needed" });
    const rich = await new FakeChain({ initialBalanceWei: 100n }).open("blaze");
    expect(await eligibleForEntry(rich, 100n, cache)).toEqual({ eligible: true, balance: 100n });
  });
});

describe("gas exhausted agents", () => {
  it("are excluded by the same path as a broke agent once gas is no longer sponsored", async () => {
    const { eligibleForEntry } = await import("../bankroll");
    const cache = new BankrollCache({ ttlMs: 0, now: () => 0 });
    // Covers the stake exactly, but nothing left for the gas the transfer costs.
    const wallet = await new FakeChain({ initialBalanceWei: 100n }).open("atlas");
    const outcome = await eligibleForEntry(wallet, 100n, cache, 50n);
    expect(outcome.eligible).toBe(false);
    if (!outcome.eligible) expect(outcome.reason).toMatch(/150 wei needed/);
    // With the reserve covered it enters as normal.
    const funded = await new FakeChain({ initialBalanceWei: 150n }).open("blaze");
    expect((await eligibleForEntry(funded, 100n, cache, 50n)).eligible).toBe(true);
  });

  it("asks the chain how much gas to reserve, so the fake chain reserves nothing", async () => {
    const fake = new FakeChain({ initialBalanceWei: 1n });
    expect(fake.gasReserveWei).toBe(0n);
    const { ViemChain } = await import("./viem");
    const viem = new ViemChain({ keys: {} });
    expect(viem.gasReserveWei).toBeGreaterThan(0n);
    // Its own budget: this line pulls in viem and AgentKit, and on a busy
    // machine that import alone has taken longer than the default five
    // seconds. It failed once during a run of real rounds on Base Sepolia.
  }, 30_000);
});
