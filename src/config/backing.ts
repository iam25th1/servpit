// Backing a fighter: points, and nothing else.
//
// A viewer picks one agent in the round and scores for calling it right. No
// wallet, no stake, no transfer and no prize of value is connected to a pick,
// because money on agent outcomes would be wagering and this project does not
// do that. The points exist to make watching a round worth something, and
// they are worth nothing anywhere else.
//
// Live rounds only, which means arena mode only. The lever route hands the
// player the round's seed, and the resolver is deterministic, so a pick made
// in lever mode could be made knowing the winner.

/** How long the pit waits for picks, between the draw and the fight. */
export const DEFAULT_BACKING_WINDOW_SECONDS = 45;
/** Floors and ceilings. Long enough to read the draw, short enough to watch. */
export const MIN_BACKING_WINDOW_SECONDS = 5;
export const MAX_BACKING_WINDOW_SECONDS = 600;

/**
 * Points shared out for a correct pick, before the split.
 *
 * The award is this divided by the share of backers who made the same pick,
 * so backing the agent everybody backed pays exactly this and backing the one
 * nobody else did pays it multiplied by the whole field.
 */
export const POINTS_PER_ROUND = 100;

/**
 * The award for one correct call among this many backers.
 *
 * Here rather than on the server because the result screen works it out too,
 * from the same counts, so what a viewer reads and what the board records
 * cannot drift. Rounded down, so the award never invents a point the split
 * does not support and every backer of the same agent is paid the same.
 */
export function pointsFor(backers: number, correct: number): number {
  if (correct <= 0 || backers <= 0) return 0;
  return Math.floor((POINTS_PER_ROUND * backers) / correct);
}

/** What a handle may be: short, lower case, and nothing that looks like a url. */
export const HANDLE_PATTERN = /^[a-z0-9_-]{3,16}$/;

/** How many picks one client may make in a minute, before it is just noise. */
export const PICKS_PER_MINUTE = 10;

/**
 * How many picks may come from one place in a minute.
 *
 * The limit above is keyed by the token a browser made for itself, which is
 * the right key for a handle and no key at all against somebody minting a
 * token per request. This one is keyed by where the request came from, and it
 * is looser on purpose: a house, an office or a lecture hall shares one
 * address, and thirty picks a minute is a room full of people changing their
 * minds.
 */
export const PICKS_PER_MINUTE_PER_PLACE = 30;

/**
 * Most backers one round may have.
 *
 * A ceiling on the log rather than on the game: a round with two thousand
 * backers is a round nobody in this project has ever seen, and a round with
 * two hundred thousand is somebody filling a disk one line at a time. A
 * backer already in the round can still change their pick after it.
 */
export const MAX_BACKERS_PER_ROUND = 2_000;

export function backingWindowSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SERVPIT_BACKING_WINDOW_SECONDS?.trim();
  if (raw === undefined || raw.length === 0) return DEFAULT_BACKING_WINDOW_SECONDS;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < MIN_BACKING_WINDOW_SECONDS || seconds > MAX_BACKING_WINDOW_SECONDS) {
    throw new RangeError(`SERVPIT_BACKING_WINDOW_SECONDS must be a whole number of seconds between ${MIN_BACKING_WINDOW_SECONDS} and ${MAX_BACKING_WINDOW_SECONDS}, got ${raw}`);
  }
  return seconds;
}

/**
 * The handle as it is stored, or null when it is not one.
 *
 * Trimmed and lower cased first, so Ash and ash are the same backer rather
 * than two rows on the leaderboard that look identical.
 */
export function normaliseHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const handle = raw.trim().toLowerCase();
  return HANDLE_PATTERN.test(handle) ? handle : null;
}
