// AgentKit fires a usage analytics event whenever a wallet provider is built.
// In @coinbase/agentkit 0.10.4 that call is made like this:
//
//   trackInitialization() {
//     try {
//       sendAnalyticsEvent({ ... });   // async, not awaited, no catch
//     } catch { ... }
//   }
//
// sendAnalyticsEvent is async, so the synchronous try cannot catch a rejected
// fetch. When the analytics host is slow, blocked or down, the rejection is
// unhandled, and an unhandled rejection terminates the process by default.
// Opening a wallet would then take the round down with it.
//
// Swallowing the failure was phase 5's fix and it is not enough. The request
// is still made, and from a machine that cannot reach the analytics host each
// one occupies a connection for the full ten second connect timeout. Building
// seven wallet providers fires seven of them, and they starve the pool the
// RPC calls need: measured here, the first two eth_getBalance calls timed out
// after 41 seconds, the third took 8, and only once the analytics attempts
// had all expired did the rest run at their usual 430 ms. That is the funding
// run "timing out at the RPC" when the RPC was answering in half a second.
//
// So the request is now refused at the fetch boundary rather than merely
// survived. Two things follow. The pool is never occupied, and the wallet
// address stops being posted to a third party on every construction, which
// on a money surface is worth more than the telemetry.
//
// The wrapper is as narrow as it can be: one host, one synthetic 204, and
// every other request handed to the original fetch untouched. The
// unhandledRejection listener stays as well, because a future AgentKit may
// reach a different host.

import { log } from "../log";

const ANALYTICS_HOST = "cca-lite.coinbase.com";

const textOf = (value: unknown): string => {
  if (value instanceof Error) return `${value.message} ${String((value as { code?: unknown }).code ?? "")}`;
  return typeof value === "string" ? value : "";
};

/** True only for a failure of AgentKit's analytics call. */
export function isAgentKitAnalyticsFailure(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  const cause = (reason as { cause?: unknown }).cause;
  const haystack = `${textOf(reason)} ${textOf(cause)}`;
  if (haystack.includes(ANALYTICS_HOST)) return true;
  // The sender throws this shape itself on a non ok response.
  return /^HTTP error! status: \d+$/.test(reason.message);
}

/** The url of whatever fetch was handed, for the three shapes it accepts. */
export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** True for AgentKit's analytics endpoint and nothing else. */
export function isAnalyticsRequest(input: RequestInfo | URL): boolean {
  try {
    return new URL(requestUrl(input)).hostname === ANALYTICS_HOST;
  } catch {
    return false;
  }
}

/**
 * Wraps a fetch so the analytics endpoint is answered locally and never
 * reaches the network. Exported for the test; the installer applies it to
 * the global.
 */
export function blockAnalytics(original: typeof fetch): typeof fetch {
  return async function fetchWithoutAnalytics(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (isAnalyticsRequest(input)) {
      // 204 rather than an error: the sender throws on a non ok status, and
      // a throw here is the unhandled rejection this file exists to avoid.
      return new Response(null, { status: 204 });
    }
    return original(input, init);
  };
}

let installed = false;

/**
 * Installs the block and the listener once. Safe to call from every chain
 * construction.
 */
export function guardAgentKitAnalytics(): void {
  if (installed || typeof process === "undefined") return;
  installed = true;
  globalThis.fetch = blockAnalytics(globalThis.fetch);
  process.on("unhandledRejection", (reason) => {
    if (isAgentKitAnalyticsFailure(reason)) {
      log.warn("agentkit analytics call failed, ignoring", { host: ANALYTICS_HOST });
      return;
    }
    // Restore the default for everything else: an unhandled rejection is a bug
    // and must still be loud.
    throw reason;
  });
}
