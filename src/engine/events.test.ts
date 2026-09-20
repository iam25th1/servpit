import { describe, expect, it } from "vitest";
import { FACING, facingToward, isFacing } from "./events";

describe("facing", () => {
  it("encodes down, up, left, right as 0 to 3", () => {
    expect(FACING).toEqual({ down: 0, up: 1, left: 2, right: 3 });
  });

  it("picks the dominant axis, horizontal on ties, with y growing downward", () => {
    expect(facingToward(3, 1)).toBe(FACING.right);
    expect(facingToward(-3, 1)).toBe(FACING.left);
    expect(facingToward(1, 4)).toBe(FACING.down);
    expect(facingToward(1, -4)).toBe(FACING.up);
    expect(facingToward(2, 2)).toBe(FACING.right);
    expect(facingToward(-2, -2)).toBe(FACING.left);
  });

  it("defaults to down when there is no displacement", () => {
    expect(facingToward(0, 0)).toBe(FACING.down);
  });

  it("isFacing accepts only the four integers", () => {
    for (const v of [0, 1, 2, 3]) expect(isFacing(v)).toBe(true);
    for (const v of [-1, 4, 1.5, Number.NaN, "0"]) expect(isFacing(v)).toBe(false);
  });
});
