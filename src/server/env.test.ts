import { describe, expect, it } from "vitest";
import { KEY_VARS, WALLET_IDS, keyVarFor } from "@/config/wallets";
import { DEFAULT_RPC_URL, DEFAULT_RPC_URLS, readEnv } from "./env";

/** Vitest types ProcessEnv strictly; these are plain string maps. */
const asEnv = (v: Record<string, string>): NodeJS.ProcessEnv => v as NodeJS.ProcessEnv;

const KEY = (n: number): string => "0x" + String(n).repeat(2).padStart(2, "0").repeat(32).slice(0, 64);
const fullKeys = (): Record<string, string> => Object.fromEntries(WALLET_IDS.map((id, i) => [keyVarFor(id), KEY(i + 1)]));

describe("readEnv wallet backend", () => {
  it("falls back to the fake chain when no keys are present", () => {
    const env = readEnv(asEnv({}));
    expect(env.walletBackend).toBe("fake");
    expect(env.network).toBe("fake");
    expect(env.viem).toBeUndefined();
  });

  it("picks viem only when every wallet has a key", () => {
    expect(readEnv(asEnv({ ...fullKeys() })).walletBackend).toBe("viem");
    const partial = fullKeys();
    delete partial[keyVarFor(WALLET_IDS[0])];
    expect(readEnv(asEnv(partial)).walletBackend).toBe("fake");
  });

  it("carries the keys and the rpc override on the viem backend", () => {
    const env = readEnv(asEnv({ ...fullKeys(), RPC_URL: "https://example.invalid" }));
    expect(Object.keys(env.viem!.keys).sort()).toEqual([...WALLET_IDS].sort());
    expect(env.viem!.rpcUrls).toEqual(["https://example.invalid"]);
    expect(env.network).toBe("base-sepolia");
  });

  it("refuses an explicit viem backend with a wallet missing its key, and names only the variable", () => {
    const partial = fullKeys();
    delete partial[keyVarFor(WALLET_IDS[1])];
    try {
      readEnv(asEnv({ ...partial, WALLET_BACKEND: "viem" }));
      throw new Error("expected a throw");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain(keyVarFor(WALLET_IDS[1]));
      expect(message).not.toMatch(/0x[0-9a-fA-F]{64}/);
    }
  });

  it("refuses a malformed key and never echoes its value", () => {
    const bad = { ...fullKeys(), [keyVarFor(WALLET_IDS[0])]: "0xdefinitelynotakey" };
    try {
      readEnv(asEnv(bad));
      throw new Error("expected a throw");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain(keyVarFor(WALLET_IDS[0]));
      expect(message).not.toContain("definitelynotakey");
    }
  });

  it("rejects an unknown backend name", () => {
    expect(() => readEnv(asEnv({ WALLET_BACKEND: "cdp" }))).toThrow(/fake or viem/);
  });

  it("registers every key with the logger so a stray log cannot print one", async () => {
    const keys = fullKeys();
    readEnv(asEnv(keys));
    const { redact } = await import("./log");
    for (const name of KEY_VARS) {
      const value = keys[name];
      expect(redact(`leaking ${value}`)).not.toContain(value);
    }
  });
});

describe("the Base Sepolia endpoints", () => {
  const keys = Object.fromEntries(KEY_VARS.map((v) => [v, `0x${"a".repeat(64)}`]));

  it("defaults to every endpoint, fastest measured first", () => {
    const env = readEnv(asEnv({ ...keys, WALLET_BACKEND: "viem" }));
    expect(env.viem?.rpcUrls).toEqual([...DEFAULT_RPC_URLS]);
    expect(DEFAULT_RPC_URL).toBe("https://base-sepolia-rpc.publicnode.com");
    // More than one, or there is nothing to fall back to.
    expect(env.viem!.rpcUrls.length).toBeGreaterThan(1);
  });

  it("takes a comma separated list from BASE_SEPOLIA_RPC_URLS, in order", () => {
    const env = readEnv(asEnv({ ...keys, WALLET_BACKEND: "viem", BASE_SEPOLIA_RPC_URLS: "https://one.test, https://two.test ,https://three.test" }));
    expect(env.viem?.rpcUrls).toEqual(["https://one.test", "https://two.test", "https://three.test"]);
  });

  it("is overridden by BASE_SEPOLIA_RPC_URL as a single entry", () => {
    const env = readEnv(asEnv({ ...keys, WALLET_BACKEND: "viem", BASE_SEPOLIA_RPC_URL: "https://example.test/rpc" }));
    expect(env.viem?.rpcUrls).toEqual(["https://example.test/rpc"]);
  });

  it("prefers the list over the single entry when both are set", () => {
    const env = readEnv(asEnv({ ...keys, WALLET_BACKEND: "viem", BASE_SEPOLIA_RPC_URL: "https://single.test", BASE_SEPOLIA_RPC_URLS: "https://a.test,https://b.test" }));
    expect(env.viem?.rpcUrls).toEqual(["https://a.test", "https://b.test"]);
  });

  it("still honours RPC_URL, so an existing setup keeps working", () => {
    const env = readEnv(asEnv({ ...keys, WALLET_BACKEND: "viem", RPC_URL: "https://old.test/rpc" }));
    expect(env.viem?.rpcUrls).toEqual(["https://old.test/rpc"]);
  });

  it("prefers the new name when both single entry names are set", () => {
    const env = readEnv(asEnv({ ...keys, WALLET_BACKEND: "viem", RPC_URL: "https://old.test", BASE_SEPOLIA_RPC_URL: "https://new.test" }));
    expect(env.viem?.rpcUrls).toEqual(["https://new.test"]);
  });

  it("falls back to the defaults rather than accepting an empty value", () => {
    expect(readEnv(asEnv({ ...keys, WALLET_BACKEND: "viem", BASE_SEPOLIA_RPC_URL: "   " })).viem?.rpcUrls).toEqual([...DEFAULT_RPC_URLS]);
    expect(readEnv(asEnv({ ...keys, WALLET_BACKEND: "viem", BASE_SEPOLIA_RPC_URLS: " , , " })).viem?.rpcUrls).toEqual([...DEFAULT_RPC_URLS]);
  });

  it("refuses an entry in the list that is not an http url", () => {
    expect(() => readEnv(asEnv({ ...keys, WALLET_BACKEND: "viem", BASE_SEPOLIA_RPC_URLS: "https://ok.test,ws://nope.test" }))).toThrow(/http or https/);
  });

  it("refuses something that is not a url rather than letting viem fail later", () => {
    expect(() => readEnv(asEnv({ ...keys, WALLET_BACKEND: "viem", BASE_SEPOLIA_RPC_URL: "sepolia.base.org" }))).toThrow(RangeError);
  });
});

describe("the gas reserve", () => {
  const keys = Object.fromEntries(KEY_VARS.map((v) => [v, `0x${"a".repeat(64)}`]));

  it("defaults to 0.00002 ETH, which is well under the funding target", () => {
    // The reserve is also the floor an agent must clear on top of its stake
    // to enter. At the old 0.0002 it was double the 0.0001 per wallet target,
    // so every agent would have been excluded from every round.
    const env = readEnv(asEnv({ ...keys, WALLET_BACKEND: "viem" }));
    expect(env.viem?.gasReserveWei).toBe(20_000_000_000_000n);
    expect(env.viem!.gasReserveWei).toBeLessThan(100_000_000_000_000n);
  });

  it("is overridden by SERVPIT_GAS_RESERVE_ETH", () => {
    const env = readEnv(asEnv({ ...keys, WALLET_BACKEND: "viem", SERVPIT_GAS_RESERVE_ETH: "0.001" }));
    expect(env.viem?.gasReserveWei).toBe(1_000_000_000_000_000n);
  });

  it("accepts zero, for a chain that does not charge", () => {
    expect(readEnv(asEnv({ ...keys, WALLET_BACKEND: "viem", SERVPIT_GAS_RESERVE_ETH: "0" })).viem?.gasReserveWei).toBe(0n);
  });

  it("refuses an amount it cannot parse", () => {
    expect(() => readEnv(asEnv({ ...keys, WALLET_BACKEND: "viem", SERVPIT_GAS_RESERVE_ETH: "lots" }))).toThrow(RangeError);
  });
});

describe("how the backend was chosen", () => {
  const keys = Object.fromEntries(KEY_VARS.map((v) => [v, `0x${"a".repeat(64)}`]));

  it("is declared when WALLET_BACKEND says so", () => {
    expect(readEnv(asEnv({ ...keys, WALLET_BACKEND: "viem" })).backendSource).toBe("declared");
    expect(readEnv(asEnv({ WALLET_BACKEND: "fake" })).backendSource).toBe("declared");
  });

  it("is inferred when it was worked out from which keys happen to be present", () => {
    // A money surface refuses to run on this, because falling through to the
    // fake chain silently looks exactly like a successful run.
    expect(readEnv(asEnv({})).backendSource).toBe("inferred");
    expect(readEnv(asEnv({ ...keys })).backendSource).toBe("inferred");
  });
});
