import { describe, expect, it } from "vitest";
import { redact } from "./log";

describe("redact", () => {
  it("masks hex private keys, mnemonics and api key shaped strings but keeps addresses", () => {
    const pk = "0x" + "ab".repeat(32);
    expect(redact(`key ${pk} done`)).toBe("key [redacted:hex64] done");
    expect(redact("token sk-live-abcdefghijklmnop1234")).toBe("token [redacted:key]");
    expect(redact("word ".repeat(12).trim())).toContain("[redacted:mnemonic]");
    expect(redact("addr 0x4252e0c9A3da5A2700e7d91cb50aEf522D0C6Fe8 ok")).toBe("addr 0x4252e0c9A3da5A2700e7d91cb50aEf522D0C6Fe8 ok");
  });

  it("redacts inside objects, arrays and nested strings", () => {
    const out = redact({ a: ["0x" + "cd".repeat(32)], b: { c: "fine" } });
    expect(out).toEqual({ a: ["[redacted:hex64]"], b: { c: "fine" } });
  });

  it("masks known secret env names by value", () => {
    expect(redact("x", { secrets: ["hunter2"] })).toBe("x");
    expect(redact("pw hunter2 end", { secrets: ["hunter2"] })).toBe("pw [redacted:secret] end");
  });
});
