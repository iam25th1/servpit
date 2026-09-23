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

/**
 * How many rounds one browser may ask for, and over how long.
 *
 * Three in six hours. A round is minutes of the operator's money and can
 * wreck an agent, so this is generous for somebody who wants to watch the
 * pit think and useless for somebody who wants to drain it.
 */
export const DEFAULT_PULLS_PER_WINDOW = 3;
export const DEFAULT_PULL_WINDOW_HOURS = 6;

/**
 * What the pit may spend on reasoning in a day, in cents.
 *
 * Measured from what rounds actually recorded, not estimated from a rate: the
 * round store already carries the cost of every round's calls, so the budget
 * is arithmetic over the last day of real spend.
 *
 * Twenty five cents is a few dozen reasoned rounds at the measured cost of
 * one, which is a day of somebody pulling the lever and nowhere near a card.
 */
export const DEFAULT_DAILY_BUDGET_CENTS = 25;

/**
 * How many rounds the lever may start in an hour, across everybody.
 *
 * Not about credit: a round is chain fees, and every round can wreck an
 * agent, which spends operator capital replacing it. Six an hour is one
 * every ten minutes.
 */
export const DEFAULT_PULLS_PER_HOUR = 6;

/** A day, for the budget, and an hour, for the cap. */
export const DAY_MS = 24 * 60 * 60_000;
export const HOUR_MS = 60 * 60_000;

/** The operator settings file, in the data directory. */
export function pullSettingsFile(dataDir: string): string {
  return `${dataDir}/pull-settings.json`;
}
