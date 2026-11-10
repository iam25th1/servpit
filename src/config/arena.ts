// The pit running itself.
//
// With arena mode off, which is the default, nothing here runs and the lever
// is what starts a round, exactly as it always has been. With it on, a worker
// plays a round every interval and the lever routes refuse: one writer, and
// it is not the browser.

/** An hour. Long enough that a day of rounds is an affordable number of them. */
export const DEFAULT_ROUND_INTERVAL_SECONDS = 3_600;

/** Floors and ceilings on the interval. A round takes minutes, not seconds. */
export const MIN_ROUND_INTERVAL_SECONDS = 5;
export const MAX_ROUND_INTERVAL_SECONDS = 24 * 3_600;

/**
 * Whether the pit plays itself.
 *
 * Off by default, so the lever flow is what a fresh checkout does. With it on
 * the worker plays a round every interval and the spectator client watches
 * them, which is where backing and the leaderboard live: both are arena mode
 * only, because the lever route hands the player the round's seed.
 */
export function arenaMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.SERVPIT_ARENA_MODE?.trim().toLowerCase();
  if (raw === undefined || raw.length === 0) return false;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new RangeError(`SERVPIT_ARENA_MODE must be true or false, got ${raw}`);
}

/** Seconds between the start of one round and the start of the next. */
export function roundIntervalSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SERVPIT_ROUND_INTERVAL_SECONDS?.trim();
  if (raw === undefined || raw.length === 0) return DEFAULT_ROUND_INTERVAL_SECONDS;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < MIN_ROUND_INTERVAL_SECONDS || seconds > MAX_ROUND_INTERVAL_SECONDS) {
    throw new RangeError(`SERVPIT_ROUND_INTERVAL_SECONDS must be a whole number of seconds between ${MIN_ROUND_INTERVAL_SECONDS} and ${MAX_ROUND_INTERVAL_SECONDS}, got ${raw}`);
  }
  return seconds;
}

/**
 * The file whose presence pauses the loop, inside the data directory.
 *
 * A file rather than an environment variable, because a running process never
 * rereads its environment: an operator who needs the pit to stop should not
 * have to restart it to be heard. Read once per interval, so a pause takes
 * effect before the next round rather than during one.
 */
export const PAUSE_FILE = "arena-paused";

/**
 * How often a pit that is out of funds looks again, in seconds.
 *
 * Ten minutes by default. A pit that cannot fund a round plays nothing, so
 * there is nothing to watch for and no reason to ask the chain every few
 * seconds; ten minutes is soon enough that a top up is noticed within one
 * coffee, and rare enough that a pit left broke overnight makes a few dozen
 * balance reads rather than thousands.
 */
export const DEFAULT_FUNDS_CHECK_SECONDS = 600;
export const MIN_FUNDS_CHECK_SECONDS = 10;
export const MAX_FUNDS_CHECK_SECONDS = 24 * 3_600;

export function fundsCheckSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SERVPIT_FUNDS_CHECK_SECONDS?.trim();
  if (raw === undefined || raw.length === 0) return DEFAULT_FUNDS_CHECK_SECONDS;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < MIN_FUNDS_CHECK_SECONDS || seconds > MAX_FUNDS_CHECK_SECONDS) {
    throw new RangeError(`SERVPIT_FUNDS_CHECK_SECONDS must be a whole number of seconds between ${MIN_FUNDS_CHECK_SECONDS} and ${MAX_FUNDS_CHECK_SECONDS}, got ${raw}`);
  }
  return seconds;
}
