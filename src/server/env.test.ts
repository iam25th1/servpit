import { describe, expect, it } from "vitest";
import { KEY_VARS, WALLET_IDS, keyVarFor } from "@/config/wallets";
import { readEnv } from "./env";

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
    expect(env.viem!.rpcUrl).toBe("https://example.invalid");
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
