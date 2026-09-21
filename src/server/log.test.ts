import { describe, expect, it } from "vitest";
import { redact, registerSecret } from "./log";

describe("redact", () => {
  it("masks hex private keys, mnemonics and api key shaped strings but keeps addresses", () => {
    const pk = "0x" + "ab".repeat(32);
    expect(redact(`key ${pk} done`)).toBe("key [redacted:hex64] done");
    // Built at runtime: a key shaped literal in a tracked file trips the
    // repository secret scanner, and an allowlist there would train us to
    // ignore it.
    const fakeKey = ["sk", "live", "abcdefghijklmnop1234"].join("-");
    expect(redact(`token ${fakeKey}`)).toBe("token [redacted:key]");
    expect(redact("word ".repeat(12).trim())).toContain("[redacted:mnemonic]");
    expect(redact("addr 0x4252e0c9A3da5A2700e7d91cb50aEf522D0C6Fe8 ok")).toBe("addr 0x4252e0c9A3da5A2700e7d91cb50aEf522D0C6Fe8 ok");
  });

  it("redacts inside objects, arrays and nested strings", () => {
    const out = redact({ a: ["0x" + "cd".repeat(32)], b: { c: "fine" } });
    expect(out).toEqual({ a: ["[redacted:hex64]"], b: { c: "fine" } });
  });

  it("keeps chain identifiers readable: a transaction hash is 64 hex like a private key, and it is the evidence", () => {
    const txHash = "0x" + "9".repeat(64);
    expect(redact({ txHash })).toEqual({ txHash });
    expect(redact({ userOpHash: txHash, transactionHash: txHash })).toEqual({ userOpHash: txHash, transactionHash: txHash });
    // Same shape under any other field name is still masked.
    expect(redact({ walletSecret: txHash })).toEqual({ walletSecret: "[redacted:hex64]" });
    expect(redact({ txHash: ["sk", "live", "abcdefghijklmnop1234"].join("-") })).toEqual({ txHash: "[redacted:key]" });
  });

  it("still masks a registered secret even under a chain identifier field name", () => {
    expect(redact({ txHash: "0x" + "a".repeat(64) }, { secrets: ["0x" + "a".repeat(64)] })).toEqual({ txHash: "[redacted:secret]" });
  });

  it("masks known secret env names by value", () => {
    expect(redact("x", { secrets: ["hunter2"] })).toBe("x");
    expect(redact("pw hunter2 end", { secrets: ["hunter2"] })).toBe("pw [redacted:secret] end");
  });
});

describe("the chain identifier carve out cannot leak a private key", () => {
  // Chain identifier fields skip shape matching so transaction hashes stay
  // readable. A private key is the same shape as a hash, so the only thing
  // standing between it and a log line is registerSecret, which readEnv calls
  // for every key before anything else reads the environment. This locks that.
  const CHAIN_FIELDS = ["address", "txHash", "transactionHash", "userOpHash", "hash", "from", "to", "potAddress", "ownerAddress"];

  it("masks a registered key in every field the carve out covers", () => {
    const key = "0x" + "cd".repeat(32);
    registerSecret(key);
    for (const field of CHAIN_FIELDS) {
      const out = redact({ [field]: key }) as Record<string, string>;
      expect(out[field], field).toBe("[redacted:secret]");
    }
    expect(redact({ nested: { list: [{ from: key }] } })).toEqual({ nested: { list: [{ from: "[redacted:secret]" }] } });
  });

  it("still lets a genuine transaction hash and address through", () => {
    const hash = "0x" + "9".repeat(64);
    const address = "0x4252e0c9A3da5A2700e7d91cb50aEf522D0C6Fe8";
    expect(redact({ txHash: hash })).toEqual({ txHash: hash });
    expect(redact({ address })).toEqual({ address });
  });

  it("masks an unregistered 32 byte value anywhere outside those fields", () => {
    const key = "0x" + "ef".repeat(32);
    expect(redact({ privateKey: key })).toEqual({ privateKey: "[redacted:hex64]" });
    expect(redact(`raw ${key}`)).toBe("raw [redacted:hex64]");
  });
});

describe("credentials embedded in an rpc url", () => {
  it("keeps the host and drops the key in the path", () => {
    // A keyed endpoint carries its credential in the path, and viem quotes
    // the whole url in every transport error, so an error that reaches a log
    // carries the key with it.
    const line = redact({ reason: "The request took too long to respond. URL: https://base-sepolia.example.com/v2/SUPERSECRETKEY" });
    expect(line.reason).not.toContain("SUPERSECRETKEY");
    expect(line.reason).toContain("base-sepolia.example.com");
    expect(line.reason).toContain("[redacted:url]");
  });

  it("drops a key in the query and a password in the userinfo", () => {
    const query = redact({ url: "https://rpc.example.com/?apikey=SUPERSECRETKEY" });
    expect(query.url).not.toContain("SUPERSECRETKEY");
    const userinfo = redact({ url: "https://user:SUPERSECRETKEY@rpc.example.com/" });
    expect(userinfo.url).not.toContain("SUPERSECRETKEY");
  });

  it("leaves a bare host alone, because there is nothing in it to leak", () => {
    expect(redact({ url: "https://sepolia.base.org" }).url).toBe("https://sepolia.base.org");
  });

  it("leaves a basescan link addressable, because it is the evidence", () => {
    // The hash inside it is still masked by the hex64 rule, which predates
    // this and applies to any field not named as a chain identifier. What
    // matters here is that the url is not collapsed to nothing.
    const link = "https://sepolia.basescan.org/tx/0x488c633d19833c59de41c3eedb74fb19551f23c2ed56fd6031917c2de7b86a9b";
    expect(redact({ link }).link).toContain("https://sepolia.basescan.org/tx/");
    expect(redact({ txHash: link }).txHash).toBe(link);
  });

  it("masks a url that is not parseable rather than passing it through", () => {
    expect(redact({ url: "https://[bad" }).url).toBe("[redacted:url]");
  });
});
