import { describe, expect, it } from "vitest";
import { assertConservation, computePot, computeRake } from "./payout";

describe("computePot", () => {
  it("multiplies stake by entrant count in minor units", () => {
    expect(computePot(100, 16)).toBe(1600);
    expect(computePot(1_000_000_000, 32)).toBe(32_000_000_000);
  });

  it("rejects non integer or non positive inputs and unsafe products", () => {
    expect(() => computePot(0, 16)).toThrow(RangeError);
    expect(() => computePot(10.5, 16)).toThrow(RangeError);
    expect(() => computePot(100, 0)).toThrow(RangeError);
    expect(() => computePot(Number.MAX_SAFE_INTEGER, 2)).toThrow(RangeError);
  });
});

describe("computeRake", () => {
  it("is zero at zero basis points", () => {
    expect(computeRake(1600, 0)).toBe(0);
  });

  it("floors pot times bps over 10000 without floating point drift", () => {
    expect(computeRake(1600, 250)).toBe(40);
    expect(computeRake(999, 1)).toBe(0);
    expect(computeRake(10_001, 1)).toBe(1);
    expect(computeRake(9_007_199_254_740_991, 9_999)).toBe(9_006_298_534_815_516);
  });

  it("rejects bps outside 0 to 10000 and non integers", () => {
    expect(() => computeRake(1600, -1)).toThrow(RangeError);
    expect(() => computeRake(1600, 10_001)).toThrow(RangeError);
    expect(() => computeRake(1600, 2.5)).toThrow(RangeError);
  });
});

describe("assertConservation", () => {
  it("passes when payouts sum exactly to the prize", () => {
    expect(() =>
      assertConservation([{ entrantId: "a", amount: 1500 }, { entrantId: "b", amount: 0 }], 1500),
    ).not.toThrow();
  });

  it("fails on any shortfall, surplus, negative or fractional amount", () => {
    expect(() => assertConservation([{ entrantId: "a", amount: 1499 }], 1500)).toThrow(/conservation/);
    expect(() => assertConservation([{ entrantId: "a", amount: 1501 }], 1500)).toThrow(/conservation/);
    expect(() => assertConservation([{ entrantId: "a", amount: 1600 }, { entrantId: "b", amount: -100 }], 1500)).toThrow(RangeError);
    expect(() => assertConservation([{ entrantId: "a", amount: 1500.5 }], 1500.5)).toThrow(RangeError);
  });
});
