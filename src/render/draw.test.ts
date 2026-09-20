import { describe, expect, it } from "vitest";
import { computeIntegerScale } from "./draw";

describe("computeIntegerScale", () => {
  it("picks the largest whole factor that fits both dimensions", () => {
    expect(computeIntegerScale(1000, 800, 384, 384)).toBe(2);
    expect(computeIntegerScale(1200, 1200, 384, 384)).toBe(3);
    expect(computeIntegerScale(384, 384, 384, 384)).toBe(1);
  });

  it("never returns a fraction or zero", () => {
    expect(computeIntegerScale(200, 200, 384, 384)).toBe(1);
    expect(computeIntegerScale(767, 900, 384, 384)).toBe(1);
    expect(computeIntegerScale(Number.NaN, 900, 384, 384)).toBe(1);
  });
});
