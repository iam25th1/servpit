import { describe, expect, it } from "vitest";
import { applyPct, assertInt, idiv } from "./intmath";

describe("idiv", () => {
  it("floors non negative integer division exactly", () => {
    expect(idiv(7, 2)).toBe(3);
    expect(idiv(0, 5)).toBe(0);
    expect(idiv(9_007_199_254_740_991, 1)).toBe(9_007_199_254_740_991);
    expect(idiv(9_007_199_254_740_990, 3)).toBe(3_002_399_751_580_330);
  });

  it("rejects negatives, fractions, zero divisor and unsafe integers", () => {
    expect(() => idiv(-1, 2)).toThrow(RangeError);
    expect(() => idiv(1.5, 2)).toThrow(RangeError);
    expect(() => idiv(1, 0)).toThrow(RangeError);
    expect(() => idiv(2 ** 53, 2)).toThrow(RangeError);
  });
});

describe("applyPct", () => {
  it("scales an integer by a percentage and floors", () => {
    expect(applyPct(100, 15)).toBe(115);
    expect(applyPct(7, 50)).toBe(10);
    expect(applyPct(100, 0)).toBe(100);
  });

  it("supports negative percentages down to minus 100", () => {
    expect(applyPct(100, -25)).toBe(75);
    expect(applyPct(100, -100)).toBe(0);
    expect(() => applyPct(100, -101)).toThrow(RangeError);
  });
});

describe("assertInt", () => {
  it("passes safe integers inside the range and names the field on failure", () => {
    expect(() => assertInt(5, "x", 0, 10)).not.toThrow();
    expect(() => assertInt(11, "x", 0, 10)).toThrow(/x/);
    expect(() => assertInt(Number.NaN, "y")).toThrow(/y/);
    expect(() => assertInt("5" as unknown as number, "z")).toThrow(/z/);
  });
});
