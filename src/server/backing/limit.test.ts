import { describe, expect, it } from "vitest";
import { RateLimiter, WINDOW_MS } from "./limit";
import { normaliseHandle } from "@/config/backing";
import { tokenHash, validToken } from "./identity";

describe("the pick rate limit", () => {
  it("lets a viewer change their mind, and stops a flood", () => {
    const limit = new RateLimiter(3, () => 0);
    expect([limit.allow("a"), limit.allow("a"), limit.allow("a")]).toEqual([true, true, true]);
    expect(limit.allow("a")).toBe(false);
  });

  it("counts each client on its own", () => {
    const limit = new RateLimiter(1, () => 0);
    expect(limit.allow("a")).toBe(true);
    expect(limit.allow("b")).toBe(true);
    expect(limit.allow("a")).toBe(false);
  });

  it("forgives once the minute has passed", () => {
    let at = 0;
    const limit = new RateLimiter(1, () => at);
    expect(limit.allow("a")).toBe(true);
    at = WINDOW_MS - 1;
    expect(limit.allow("a")).toBe(false);
    at = WINDOW_MS;
    expect(limit.allow("a")).toBe(true);
  });
});

describe("a handle", () => {
  it("is the same backer however it was typed", () => {
    expect(normaliseHandle("  Ash  ")).toBe("ash");
    expect(normaliseHandle("ASH")).toBe("ash");
  });

  it("is refused when it is not a name, so the board cannot carry a url or a script", () => {
    for (const bad of ["ab", "a".repeat(17), "ash pit", "<b>ash</b>", "http://x.co/a", "ash!", 7, null, undefined]) {
      expect(normaliseHandle(bad as unknown)).toBeNull();
    }
  });
});

describe("a device token", () => {
  it("is stored as a hash and never as itself", () => {
    const token = crypto.randomUUID();
    const hash = tokenHash(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(tokenHash(token)).toBe(hash);
  });

  it("refuses anything too short to be random, or long enough to be an attack", () => {
    expect(validToken("short")).toBeNull();
    expect(validToken("x".repeat(500))).toBeNull();
    expect(validToken(crypto.randomUUID())).not.toBeNull();
  });
});
