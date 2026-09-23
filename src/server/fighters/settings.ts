// What the operator lets the pit hand out, read fresh every time it is asked.
//
// A file in the data directory, like the pause file and the reasoning switch,
// for the same reason: a running worker and a running site both hold their
// context for the life of the process, and an operator changing a limit while
// visitors are claiming should not have to restart either of them.
//
// Written from a terminal and nowhere else.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CLAIMABLE_FACES, DEFAULT_RELEASE_HOURS, DEFAULT_SEAT_CAP, DEFAULT_SEAT_RESERVE } from "@/config/fighters";

export interface FighterSettings {
  /** Most seats that may be claimed at once. */
  cap: number;
  /** Seats the pit tries to keep free for somebody new. */
  reserve: number;
  /** How long a claim survives without a visit, in hours. */
  releaseHours: number;
}

export const DEFAULT_FIGHTER_SETTINGS: FighterSettings = {
  cap: DEFAULT_SEAT_CAP,
  reserve: DEFAULT_SEAT_RESERVE,
  releaseHours: DEFAULT_RELEASE_HOURS,
};

/** A whole number in range, or the default when the file says something else. */
function whole(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

/**
 * The settings, or the defaults.
 *
 * A file that cannot be read or does not parse reads as the defaults, and
 * deliberately so: the failure mode of a corrupt settings file has to be the
 * pit's ordinary limits rather than no limits at all.
 */
export function readFighterSettings(file: string): FighterSettings {
  if (!existsSync(file)) return { ...DEFAULT_FIGHTER_SETTINGS };
  let body: unknown;
  try {
    body = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { ...DEFAULT_FIGHTER_SETTINGS };
  }
  const raw = (body ?? {}) as Partial<Record<keyof FighterSettings, unknown>>;
  const cap = whole(raw.cap, DEFAULT_FIGHTER_SETTINGS.cap, 1, CLAIMABLE_FACES.length);
  return {
    cap,
    // Never more reserve than there are seats: a reserve that swallowed the
    // cap would be a pit nobody could claim in.
    reserve: Math.min(whole(raw.reserve, DEFAULT_FIGHTER_SETTINGS.reserve, 0, CLAIMABLE_FACES.length), Math.max(0, cap - 1)),
    releaseHours: whole(raw.releaseHours, DEFAULT_FIGHTER_SETTINGS.releaseHours, 1, 24 * 365),
  };
}

/** Writes the settings whole, so a half written file cannot loosen a limit. */
export function writeFighterSettings(file: string, settings: FighterSettings): FighterSettings {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  return settings;
}
