import { describe, expect, it, vi } from "vitest";
import { ViemChain, type WalletProviderLike } from "./viem";

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

const chainWith = (providers: Record<string, WalletProviderLike>, keys: Record<string, `0x${string}`> = { atlas: KEY_A, pot: KEY_B }) =>
  new ViemChain({ keys, rpcUrl: "https://example.invalid" }, (walletId) => {
    const p = providers[walletId];
    if (!p) throw new Error(`no stub provider for ${walletId}`);
    return p;
  });

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
    const chain = new ViemChain({ keys: { atlas: KEY_A }, rpcUrl: "https://example.invalid" }, factory);
    const first = await chain.open("atlas");
    const second = await chain.open("atlas");
    await first.getBalance();
    await second.getBalance();
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe("ViemChain balances and transfers", () => {
  it("reads the balance from the provider every time, never from a cached copy", async () => {
    const a = stubProvider(ADDR_A, 500n);
    const chain = chainWith({ atlas: a.provider });
    const wallet = await chain.open("atlas");
    expect(await wallet.getBalance()).toBe(500n);
    a.setBalance(900n);
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
