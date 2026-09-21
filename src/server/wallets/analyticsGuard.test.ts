import { describe, expect, it } from "vitest";
import { blockAnalytics, isAgentKitAnalyticsFailure, isAnalyticsRequest } from "./analyticsGuard";

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

describe("blocking the analytics request", () => {
  it("recognises the analytics endpoint in every shape fetch accepts", () => {
    expect(isAnalyticsRequest("https://cca-lite.coinbase.com/amp")).toBe(true);
    expect(isAnalyticsRequest(new URL("https://cca-lite.coinbase.com/amp"))).toBe(true);
    expect(isAnalyticsRequest(new Request("https://cca-lite.coinbase.com/amp"))).toBe(true);
  });

  it("leaves every other host alone, including one that merely contains the name", () => {
    expect(isAnalyticsRequest("https://base-sepolia-rpc.publicnode.com")).toBe(false);
    expect(isAnalyticsRequest("https://sepolia.base.org")).toBe(false);
    // Host match, not substring: this is a different origin entirely.
    expect(isAnalyticsRequest("https://evil.test/?x=cca-lite.coinbase.com")).toBe(false);
    expect(isAnalyticsRequest("not a url")).toBe(false);
  });

  it("answers the analytics call locally without touching the network", async () => {
    let calls = 0;
    const wrapped = blockAnalytics((async () => { calls++; return new Response("x"); }) as typeof fetch);
    const res = await wrapped("https://cca-lite.coinbase.com/amp", { method: "POST" });
    expect(calls).toBe(0);
    expect(res.status).toBe(204);
    // The sender throws on a non ok status, and that throw is the unhandled
    // rejection this module exists to prevent.
    expect(res.ok).toBe(true);
  });

  it("passes everything else through untouched", async () => {
    const seen: Array<{ url: unknown; init: unknown }> = [];
    const wrapped = blockAnalytics((async (url, init) => { seen.push({ url, init }); return new Response("ok"); }) as typeof fetch);
    const res = await wrapped("https://base-sepolia-rpc.publicnode.com", { method: "POST", body: "{}" });
    expect(await res.text()).toBe("ok");
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://base-sepolia-rpc.publicnode.com");
    expect((seen[0].init as RequestInit).body).toBe("{}");
  });
});
