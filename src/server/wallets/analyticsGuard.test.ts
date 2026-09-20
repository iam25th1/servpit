import { describe, expect, it } from "vitest";
import { isAgentKitAnalyticsFailure } from "./analyticsGuard";

describe("isAgentKitAnalyticsFailure", () => {
  it("recognises the connect timeout AgentKit produces when its analytics host is unreachable", () => {
    const reason = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("Connect Timeout Error (attempted address: cca-lite.coinbase.com:443, timeout: 10000ms)"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    });
    expect(isAgentKitAnalyticsFailure(reason)).toBe(true);
  });

  it("recognises a DNS failure and an HTTP error from the same host", () => {
    expect(isAgentKitAnalyticsFailure(Object.assign(new TypeError("fetch failed"), { cause: new Error("getaddrinfo ENOTFOUND cca-lite.coinbase.com") }))).toBe(true);
    expect(isAgentKitAnalyticsFailure(new Error("HTTP error! status: 503"))).toBe(true);
  });

  it("does not swallow an ordinary application failure", () => {
    for (const reason of [
      new Error("insufficient funds for gas * price + value"),
      new Error("payout conservation violated: paid 100 against prize 90"),
      new TypeError("fetch failed"),
      "a string rejection",
      undefined,
      null,
    ]) {
      expect(isAgentKitAnalyticsFailure(reason), String(reason)).toBe(false);
    }
  });

  it("does not swallow a fetch failure to any other host", () => {
    const reason = Object.assign(new TypeError("fetch failed"), { cause: new Error("Connect Timeout Error (attempted address: sepolia.base.org:443, timeout: 10000ms)") });
    expect(isAgentKitAnalyticsFailure(reason)).toBe(false);
  });
});
