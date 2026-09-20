import { describe, expect, it } from "vitest";
import { idempotencyKey } from "./idempotency";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("idempotencyKey", () => {
  it("is a deterministic version 5 style uuid for round, agent and kind", () => {
    const a = idempotencyKey("round-1", "atlas", "entry");
    expect(a).toMatch(UUID);
    expect(idempotencyKey("round-1", "atlas", "entry")).toBe(a);
  });

  it("differs across rounds, agents and kinds", () => {
    const keys = new Set([
      idempotencyKey("round-1", "atlas", "entry"),
      idempotencyKey("round-2", "atlas", "entry"),
      idempotencyKey("round-1", "blaze", "entry"),
      idempotencyKey("round-1", "atlas", "payout"),
    ]);
    expect(keys.size).toBe(4);
  });

  it("rejects empty or unsafe parts", () => {
    expect(() => idempotencyKey("", "atlas", "entry")).toThrow(RangeError);
    expect(() => idempotencyKey("round:1", "atlas", "entry")).toThrow(RangeError);
    expect(() => idempotencyKey("round-1", "a".repeat(65), "entry")).toThrow(RangeError);
  });
});
