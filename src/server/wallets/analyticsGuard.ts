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
// This installs one narrow listener that swallows exactly that failure and
// rethrows everything else, so ordinary bugs still crash as loudly as before.
// It does not suppress the request, only its failure.

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

let installed = false;

/**
 * Installs the listener once. Safe to call from every chain construction.
 */
export function guardAgentKitAnalytics(): void {
  if (installed || typeof process === "undefined") return;
  installed = true;
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
