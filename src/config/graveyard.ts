// How the graveyard is kept on disk.
//
// One line per retirement, appended, in a file that is set aside and
// compressed once it is big enough or a day old. The whole file used to be
// rewritten on every retirement, which is fine for a hundred rows and was
// fifty four megabytes a round by the time the pit had retired eighty nine
// thousand agents.

/** Four megabytes, about ten thousand retirements, before a file is set aside. */
export const DEFAULT_GRAVEYARD_ROTATE_MB = 4;

/**
 * Old files kept, oldest dropped first. Sixty days of a pit that retires an
 * agent or two a day is sixty small files; a busier pit rotates by size and
 * keeps the most recent sixty.
 */
export const DEFAULT_GRAVEYARD_KEEP = 60;

export interface GraveyardOptions {
  /** A file at or past this many bytes is set aside before the next line. */
  maxBytes: number;
  /** How many set aside files are kept. */
  keep: number;
}

function wholeNumber(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw.length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a whole number between ${min} and ${max}, got ${raw}`);
  }
  return value;
}

export function graveyardOptions(env: NodeJS.ProcessEnv = process.env): GraveyardOptions {
  return {
    maxBytes: wholeNumber(env, "SERVPIT_GRAVEYARD_ROTATE_MB", DEFAULT_GRAVEYARD_ROTATE_MB, 1, 1_024) * 1024 * 1024,
    keep: wholeNumber(env, "SERVPIT_GRAVEYARD_KEEP", DEFAULT_GRAVEYARD_KEEP, 1, 10_000),
  };
}
