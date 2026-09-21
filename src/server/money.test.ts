import { describe, expect, it } from "vitest";
import { basescanTx, basescanAddress, fromWei, sumWei, toWei } from "./money";
import { weiPerChip } from "@/config/stake";

describe("wei conversions", () => {
  it("converts chips to wei and back", () => {
    // The engine counts in chips and the chain in wei. A chip is worth
    // weiPerChip, and the two were only ever equal by coincidence.
    const per = weiPerChip();
    expect(toWei(10)).toBe(10n * per);
    expect(toWei(240)).toBe(240n * per);
    expect(fromWei(240n * per)).toBe(240);
    expect(toWei(0)).toBe(0n);
  });

  it("round trips whatever the chip is worth", () => {
    for (const chips of [1, 10, 240, 9999]) expect(fromWei(toWei(chips))).toBe(chips);
  });

  it("rounds a part chip down rather than inventing one", () => {
    expect(fromWei(weiPerChip() * 3n + weiPerChip() / 2n)).toBe(3);
    expect(fromWei(weiPerChip() - 1n)).toBe(0);
  });

  it("refuses floats, negatives, NaN and values past the safe range", () => {
    for (const bad of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) expect(() => toWei(bad)).toThrow(RangeError);
    expect(() => fromWei(-1n)).toThrow(RangeError);
    expect(() => fromWei(2n ** 53n * weiPerChip())).toThrow(RangeError);
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
