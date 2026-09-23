// What the operator lets the lever do, read fresh every time it is asked.
//
// A file in the data directory, like the pause file and the reasoning switch,
// for the same reason: a running worker and a running site both hold their
// context for the life of the process, and an operator tightening a limit
// because somebody is leaning on the lever should not have to restart either
// of them to be heard.
//
// Written from a terminal and nowhere else. Nothing over HTTP reaches this,
// because these numbers are what stands between a public button and the
// operator's account.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_DAILY_BUDGET_CENTS, DEFAULT_PULLS_PER_HOUR, DEFAULT_PULLS_PER_WINDOW, DEFAULT_PULL_WINDOW_HOURS } from "@/config/pulls";

export interface PullSettings {
  /** Asks one browser may make per window, or null for no limit at all. */
  perIdentity: number | null;
  /** How long that window is, in hours. */
  windowHours: number;
  /** What reasoning may cost in a day, in cents, measured from real spend. */
  dailyBudgetCents: number;
  /** Rounds the lever may start in an hour, across everybody. */
  perHour: number;
}

export const DEFAULT_PULL_SETTINGS: PullSettings = {
  perIdentity: DEFAULT_PULLS_PER_WINDOW,
  windowHours: DEFAULT_PULL_WINDOW_HOURS,
  dailyBudgetCents: DEFAULT_DAILY_BUDGET_CENTS,
  perHour: DEFAULT_PULLS_PER_HOUR,
};

/** A whole number in range, or the default when the file says something else. */
function whole(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

/**
 * The settings, or the defaults.
 *
 * A missing file is a pit nobody has configured, which is the defaults. A
 * file that cannot be read or does not parse is also the defaults, and
 * deliberately so: the failure mode of a corrupt settings file must be the
 * tightest sensible limits rather than no limits.
 */
export function readPullSettings(file: string): PullSettings {
  if (!existsSync(file)) return { ...DEFAULT_PULL_SETTINGS };
  let body: unknown;
  try {
    body = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { ...DEFAULT_PULL_SETTINGS };
  }
  const raw = (body ?? {}) as Partial<Record<keyof PullSettings, unknown>>;
  const perIdentity = raw.perIdentity === null ? null : whole(raw.perIdentity, DEFAULT_PULL_SETTINGS.perIdentity ?? DEFAULT_PULLS_PER_WINDOW, 1, 1_000);
  return {
    perIdentity,
    windowHours: whole(raw.windowHours, DEFAULT_PULL_SETTINGS.windowHours, 1, 24 * 7),
    dailyBudgetCents: whole(raw.dailyBudgetCents, DEFAULT_PULL_SETTINGS.dailyBudgetCents, 0, 100_000),
    perHour: whole(raw.perHour, DEFAULT_PULL_SETTINGS.perHour, 1, 1_000),
  };
}

/** Writes the settings whole, so a half written file cannot loosen a limit. */
export function writePullSettings(file: string, settings: PullSettings): PullSettings {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  return settings;
}
