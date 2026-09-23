import { describe, expect, it } from "vitest";
import { UNKNOWN_VISITOR, visitorKey } from "./visitor";

const from = (headers: Record<string, string>): string => visitorKey(new Headers(headers));

describe("keying a request by where it came from", () => {
  it("uses the address the tunnel put on the request", () => {
    expect(from({ "cf-connecting-ip": "203.0.113.7" })).toBe(from({ "cf-connecting-ip": "203.0.113.7" }));
    expect(from({ "cf-connecting-ip": "203.0.113.7" })).not.toBe(from({ "cf-connecting-ip": "203.0.113.8" }));
  });

  it("prefers it to a forwarded header a client could have written", () => {
    const keyed = from({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" });
    expect(keyed).toBe(from({ "cf-connecting-ip": "203.0.113.7" }));
  });

  it("falls back to the first hop of a forwarded header", () => {
    expect(from({ "x-forwarded-for": "198.51.100.1, 70.0.0.1" })).toBe(from({ "x-forwarded-for": "198.51.100.1" }));
  });

  it("counts a request with neither as one place", () => {
    expect(from({})).toBe(UNKNOWN_VISITOR);
  });

  it("never returns the address itself", () => {
    const keyed = from({ "cf-connecting-ip": "203.0.113.7" });
    expect(keyed).not.toContain("203.0.113.7");
    expect(keyed).toMatch(/^[0-9a-f]{64}$/);
  });
});
