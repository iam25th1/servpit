import { describe, expect, it, vi } from "vitest";
import { createBalanceReader, ViemChain, type ChainReader, type WalletProviderLike } from "./viem";

const KEY_A = ("0x" + "11".repeat(32)) as `0x${string}`;
const KEY_B = ("0x" + "22".repeat(32)) as `0x${string}`;
const ADDR_A = "0x" + "aa".repeat(20);
const ADDR_B = "0x" + "bb".repeat(20);

function stubProvider(address: string, balance = 1_000_000n) {
  const sent: Array<{ to: string; value: bigint }> = [];
  let nextBalance = balance;
  const provider: WalletProviderLike = {
    getAddress: () => address,
    getBalance: async () => nextBalance,
    sendTransaction: async (tx) => {
      sent.push({ to: tx.to, value: tx.value });
      nextBalance -= tx.value;
      return ("0x" + String(sent.length).padStart(64, "f")) as `0x${string}`;
    },
    waitForTransactionReceipt: async (hash) => ({ status: "success", transactionHash: hash }),
  };
  return { provider, sent, setBalance: (v: bigint) => { nextBalance = v; } };
}

/** Balances come from the fallback reader now, not from AgentKit's provider. */
const stubReader = (balances: Record<string, bigint>): ChainReader & { calls: number } => {
  const reader = {
    calls: 0,
    async readBalances(addresses: readonly string[]) {
      reader.calls += 1;
      return addresses.map((a) => balances[a] ?? 0n);
    },
    async checkBroadcast() {
      return { state: "dropped" } as const;
    },
    async nextNonce() {
      return 0;
    },
    async nonceOf() {
      return null;
    },
  };
  return reader;
};

const chainWith = (providers: Record<string, WalletProviderLike>, keys: Record<string, `0x${string}`> = { atlas: KEY_A, pot: KEY_B }, reader?: ChainReader) =>
  new ViemChain(
    { keys, rpcUrls: ["https://example.invalid"] },
    (walletId) => {
      const p = providers[walletId];
      if (!p) throw new Error(`no stub provider for ${walletId}`);
      return p;
    },
    reader ?? stubReader({ [ADDR_A]: 1_000_000n, [ADDR_B]: 2_000_000n }),
  );

describe("ViemChain wiring", () => {
  it("reports the base-sepolia network and a viem backend", () => {
    const chain = chainWith({ atlas: stubProvider(ADDR_A).provider });
    expect(chain.network).toBe("base-sepolia");
    expect(chain.kind).toBe("viem");
    expect(chain.settles).toBe(true);
  });

  it("opens one wallet per id at the address its key derives", async () => {
    const a = stubProvider(ADDR_A);
    const b = stubProvider(ADDR_B);
    const chain = chainWith({ atlas: a.provider, pot: b.provider });
    expect((await chain.open("atlas")).address).toBe(ADDR_A);
    expect((await chain.open("pot")).address).toBe(ADDR_B);
  });

  it("refuses a wallet with no key rather than silently inventing one", async () => {
    const chain = chainWith({ atlas: stubProvider(ADDR_A).provider });
    await expect(chain.open("ghost")).rejects.toThrow(/SERVPIT_KEY_GHOST/);
  });

  it("refuses an id that is not a safe wallet name", async () => {
    const chain = chainWith({ atlas: stubProvider(ADDR_A).provider });
    await expect(chain.open("../evil")).rejects.toThrow(/wallet id/);
  });

  it("refuses when the persisted address does not match the key", async () => {
    const chain = chainWith({ atlas: stubProvider(ADDR_A).provider });
    await expect(chain.open("atlas", ADDR_B)).rejects.toThrow(/does not match/);
    await expect(chain.open("atlas", ADDR_A)).resolves.toBeDefined();
  });

  it("builds each provider once per wallet, not once per call", async () => {
    const a = stubProvider(ADDR_A);
    const factory = vi.fn().mockReturnValue(a.provider);
    const chain = new ViemChain({ keys: { atlas: KEY_A }, rpcUrls: ["https://example.invalid"] }, factory, stubReader({ [ADDR_A]: 1n }));
    const first = await chain.open("atlas");
    const second = await chain.open("atlas");
    await first.getBalance();
    await second.getBalance();
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe("ViemChain balances and transfers", () => {
  it("reads the balance from the chain every time, never from a cached copy", async () => {
    let balance = 500n;
    const chain = chainWith({ atlas: stubProvider(ADDR_A).provider }, { atlas: KEY_A }, { readBalances: async (a: readonly string[]) => a.map(() => balance), checkBroadcast: async () => ({ state: "dropped" }) as const, nextNonce: async () => 0, nonceOf: async () => null });
    const wallet = await chain.open("atlas");
    expect(await wallet.getBalance()).toBe(500n);
    balance = 900n;
    expect(await wallet.getBalance()).toBe(900n);
  });

  it("sends each call as its own transaction, in order, because an EOA cannot batch", async () => {
    const a = stubProvider(ADDR_A);
    const chain = chainWith({ atlas: a.provider });
    const wallet = await chain.open("atlas");
    const receipt = await wallet.send([{ to: ADDR_B, value: 10n }, { to: ADDR_B, value: 20n }], "key-1");
    expect(a.sent).toEqual([{ to: ADDR_B, value: 10n }, { to: ADDR_B, value: 20n }]);
    expect(receipt.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(receipt.status).toBe("complete");
  });

  it("waits for each receipt and fails loudly when one reverts", async () => {
    const a = stubProvider(ADDR_A);
    a.provider.waitForTransactionReceipt = async (hash) => ({ status: "reverted", transactionHash: hash });
    const chain = chainWith({ atlas: a.provider });
    const wallet = await chain.open("atlas");
    await expect(wallet.send([{ to: ADDR_B, value: 10n }], "key-2")).rejects.toThrow(/reverted/);
  });

  it("surfaces the reason when the chain rejects the send", async () => {
    const a = stubProvider(ADDR_A);
    a.provider.sendTransaction = async () => {
      throw new Error("insufficient funds for gas * price + value");
    };
    const chain = chainWith({ atlas: a.provider });
    const wallet = await chain.open("atlas");
    await expect(wallet.send([{ to: ADDR_B, value: 10n }], "key-3")).rejects.toThrow(/insufficient funds/);
  });

  it("rejects a destination that is not an address before touching the chain", async () => {
    const a = stubProvider(ADDR_A);
    const chain = chainWith({ atlas: a.provider });
    const wallet = await chain.open("atlas");
    await expect(wallet.send([{ to: "not-an-address", value: 1n }], "key-4")).rejects.toThrow(/address/);
    expect(a.sent).toHaveLength(0);
  });
});

describe("balance reads", () => {
  it("reads every balance in one request rather than one per wallet", async () => {
    const reader = stubReader({ [ADDR_A]: 11n, [ADDR_B]: 22n });
    const chain = chainWith({ atlas: stubProvider(ADDR_A).provider, pot: stubProvider(ADDR_B).provider }, undefined, reader);
    const balances = await chain.getBalances([ADDR_A, ADDR_B]);
    expect(balances).toEqual({ [ADDR_A]: 11n, [ADDR_B]: 22n });
    expect(reader.calls).toBe(1);
  });

  it("asks for each address once, however many times it was listed", async () => {
    const reader = stubReader({ [ADDR_A]: 11n });
    const chain = chainWith({ atlas: stubProvider(ADDR_A).provider }, { atlas: KEY_A }, reader);
    await chain.getBalances([ADDR_A, ADDR_A, ADDR_A]);
    expect(reader.calls).toBe(1);
  });

  it("does not go through AgentKit's provider, which has no fallback", async () => {
    // AgentKit builds its own public client with one endpoint and viem's ten
    // second default. A balance read that went through it would ignore every
    // endpoint configured here, which is what took the decision phase down.
    const a = stubProvider(ADDR_A, 999n);
    const providerBalance = vi.spyOn(a.provider, "getBalance");
    const chain = chainWith({ atlas: a.provider }, { atlas: KEY_A }, stubReader({ [ADDR_A]: 11n }));
    const wallet = await chain.open("atlas");
    expect(await wallet.getBalance()).toBe(11n);
    expect(providerBalance).not.toHaveBeenCalled();
  });

  it("refuses to look up something that is not an address", async () => {
    const chain = chainWith({ atlas: stubProvider(ADDR_A).provider }, { atlas: KEY_A });
    await expect(chain.getBalances(["not-an-address"])).rejects.toThrow(/needs an address/);
  });

  it("builds a real reader over every endpoint it is given", () => {
    // Construction only: the test has no network. It proves the list is
    // accepted and that an empty list still produces a usable reader.
    expect(createBalanceReader(["https://one.invalid", "https://two.invalid"])).toBeDefined();
    expect(createBalanceReader([])).toBeDefined();
  });
});
