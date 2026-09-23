// Pulling the lever in arena mode.
//
// In lever mode a visitor starts a round by asking the round routes for one,
// and gets the plan and the seed back, which is why those routes are closed
// in arena mode: the resolver is deterministic, so a seed is a winner. A pull
// is the other shape of the same wish. It asks the pit for a round and is
// told only that the ask landed. The worker is still the only writer, the
// round still plays exactly as a scheduled one does, and nothing about the
// outcome travels back down the request.

/** How often the worker looks for a request while it is waiting. */
export const PULL_POLL_MS = 1_000;

/**
 * How long a request is worth acting on.
 *
 * A pull is a person waiting at a screen. If the worker was down when it
 * landed, playing that round twenty minutes later is not what they asked
 * for, so a request that old is skipped rather than honoured.
 */
export const PULL_STALE_MS = 5 * 60_000;

/** The log of requests, in the data directory, one file per network. */
export function pullFile(dataDir: string, network: string): string {
  return `${dataDir}/pulls-${network}.ndjson`;
}
