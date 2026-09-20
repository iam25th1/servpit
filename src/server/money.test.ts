import { describe, expect, it } from "vitest";
import { basescanTx, basescanAddress, fromWei, sumWei, toWei } from "./money";

describe("wei conversions", () => {
  it("converts safe non negative integers to bigint and back", () => {
    expect(toWei(10_000_000_000_000)).toBe(10_000_000_000_000n);
    expect(fromWei(240_000_000_000_000n)).toBe(240_000_000_000_000);
    expect(toWei(0)).toBe(0n);
  });

  it("refuses floats, negatives, NaN and values past the safe range", () => {
    for (const bad of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) expect(() => toWei(bad)).toThrow(RangeError);
    expect(() => fromWei(-1n)).toThrow(RangeError);
    expect(() => fromWei(2n ** 53n)).toThrow(RangeError);
  });

  it("sums bigints exactly", () => {
    expect(sumWei([1n, 2n, 3n])).toBe(6n);
    expect(sumWei([])).toBe(0n);
  });
});

describe("basescan links", () => {
  it("builds testnet links from hashes and addresses", () => {
    expect(basescanTx("base-sepolia", "0xabc")).toBe("https://sepolia.basescan.org/tx/0xabc");
    expect(basescanAddress("base-sepolia", "0xdef")).toBe("https://sepolia.basescan.org/address/0xdef");
    expect(basescanTx("base-mainnet", "0x1")).toBe("https://basescan.org/tx/0x1");
  });
});
