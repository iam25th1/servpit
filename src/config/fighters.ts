// A fighter of your own in the pit.
//
// A house seat with a name on it. The pit fills its field to twenty four with
// house bots that nobody owns; a claimed fighter is one of those seats with a
// visitor's name and face attached. It enters every round, it costs nothing
// and pays nothing, and the fight resolves exactly as it did: no wallet, no
// stake, no borrowing, and nothing it does reaches a model.
//
// The record is the point. A fighter is mostly luck, one seat in twenty four,
// which is why its board is its own rather than mixed into the one that
// scores calling a winner.

import { ROSTER } from "./roster";
import { ORIGINAL_FACES } from "./replacements";

/** The prefix a claimed seat's entrant id carries, like agent- and bot-. */
export const FIGHTER_PREFIX = "fighter-";

/** The entrant id for a handle's fighter. Stable, so a career can follow it. */
export function fighterEntrantId(handle: string): string {
  return `${FIGHTER_PREFIX}${handle}`;
}

/** True for an entrant that is somebody's claimed fighter. */
export function isFighterEntrant(entrantId: string): boolean {
  return entrantId.startsWith(FIGHTER_PREFIX);
}

/** The handle behind a claimed seat, or null for anything else. */
export function handleOfEntrant(entrantId: string): string | null {
  return isFighterEntrant(entrantId) ? entrantId.slice(FIGHTER_PREFIX.length) : null;
}

/**
 * The faces a visitor may take.
 *
 * Everything on the roster except the five the originals wear, because a
 * viewer should never have to work out which Knight is Atlas. First come
 * first served, and a face goes back in the pool when a claim is released.
 */
export const CLAIMABLE_FACES: readonly string[] = Object.freeze(ROSTER.map((entry) => entry.id).filter((id) => !ORIGINAL_FACES.includes(id)));

/** What a fighter may be called: short, and drawable by the pack's 8x8 font. */
export const FIGHTER_NAME_PATTERN = /^[A-Za-z0-9_-]{2,10}$/;

/**
 * The name as it is stored, or null when it is not one.
 *
 * Ten characters, because the nameplate is drawn above a sixteen pixel
 * sprite in an eight pixel font and anything longer is a banner rather than a
 * name. Case is kept: a name is a name, unlike a handle, which is a key.
 */
export function normaliseFighterName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return FIGHTER_NAME_PATTERN.test(name) ? name : null;
}

/** The claims log, in the data directory, one file per network. */
export function fighterFile(dataDir: string, network: string): string {
  return `${dataDir}/fighters-${network}.ndjson`;
}

/** How many claims one browser may make in a minute, before it is noise. */
export const CLAIMS_PER_MINUTE = 5;
