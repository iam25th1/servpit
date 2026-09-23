// The rules a claim has to pass, in one place the route and the tests share.
//
// A claim is a public write like a pick: it is bound to a handle, which is
// bound to the hash of a device token, it is rate limited before it reaches
// the disk, and the write itself is one line under the append lock. It moves
// no money and starts no round.
//
// What comes back is the fighter and the faces still free. Nothing about a
// round travels down this path at all.

import { normaliseHandle } from "@/config/backing";
import { CLAIMABLE_FACES, normaliseFighterName } from "@/config/fighters";
import { tokenHash, validToken } from "../backing/identity";
import type { RateLimiter } from "../backing/limit";
import { firstOwner, type HandleOwners } from "../identity/handles";
import type { CareerRow } from "./careerStore";
import type { Fighter, FighterStore } from "./log";

/** A fighter as a viewer sees it. No token, no hash, ever. */
export interface FighterView {
  handle: string;
  name: string;
  face: string;
  entrantId: string;
}

export interface ClaimView {
  /** This browser's fighter, or null when it has none. */
  fighter: FighterView | null;
  /** Faces nobody is using, so the interface can offer them. */
  freeFaces: string[];
  /** One sentence a player can read. */
  message: string;
  /** This fighter's record, or null before it has been in a round. */
  career?: CareerRow | null;
}

export type ClaimAnswer = { ok: true; view: ClaimView } | { ok: false; status: number; message: string };

export interface ClaimInput {
  handle: unknown;
  token: unknown;
  name: unknown;
  face: unknown;
}

export interface FighterDeps {
  store: FighterStore;
  limiter: RateLimiter;
  arenaMode: boolean;
  /** Most seats that may be claimed at once. Zero means no cap. */
  cap?: number;
  /** The other claim logs, so one handle is one browser everywhere. */
  logs?: readonly HandleOwners[];
  /** This handle's record, when there is a board to read it from. */
  career?: (handle: string) => CareerRow | null;
}

export const shown = (fighter: Fighter): FighterView => ({ handle: fighter.handle, name: fighter.name, face: fighter.face, entrantId: fighter.entrantId });

/** This browser's fighter and what is left to take, without claiming anything. */
export function fighterStatus(input: { handle: unknown; token: unknown }, deps: FighterDeps): ClaimView {
  const handle = normaliseHandle(input.handle);
  const token = validToken(input.token);
  const fighter = handle === null ? null : deps.store.fighterOf(handle);
  const mine = fighter !== null && token !== null && fighter.tokenHash === tokenHash(token) ? fighter : null;
  // A visit, so a claim somebody is still watching is not released under them.
  if (mine) deps.store.seen(mine.handle);
  return {
    fighter: mine ? shown(mine) : null,
    freeFaces: deps.store.freeFaces(),
    message: mine ? `${mine.name} is yours, and enters every round.` : "Claim a fighter and it enters every round.",
    career: mine ? (deps.career?.(mine.handle) ?? null) : null,
  };
}

/**
 * Takes a seat, or says plainly why it was not taken.
 *
 * The order is what is wrong with the request, then how often this browser is
 * asking, then what the pit has left, so somebody fixing a name is not also
 * told the pit is full.
 */
export function claimFighter(input: ClaimInput, deps: FighterDeps): ClaimAnswer {
  if (!deps.arenaMode) return { ok: false, status: 403, message: "Fighters are for the live pit." };

  const handle = normaliseHandle(input.handle);
  if (handle === null) return { ok: false, status: 400, message: "A handle is 3 to 16 letters, numbers, dashes or underscores." };
  const token = validToken(input.token);
  if (token === null) return { ok: false, status: 400, message: "This browser has no token yet." };
  const name = normaliseFighterName(input.name);
  if (name === null) return { ok: false, status: 400, message: "A fighter's name is 2 to 10 letters, numbers, dashes or underscores." };
  const face = typeof input.face === "string" ? input.face.trim() : "";
  if (!CLAIMABLE_FACES.includes(face)) return { ok: false, status: 400, message: "Pick one of the faces the pit is offering." };

  const hash = tokenHash(token);
  const elsewhere = firstOwner(handle, deps.logs ?? []);
  if (elsewhere !== null && elsewhere !== hash) {
    return { ok: false, status: 409, message: "That handle belongs to another browser. Pick another one." };
  }
  if (!deps.limiter.allow(hash)) return { ok: false, status: 429, message: "That is a lot of claiming. Give it a moment." };

  const answer = deps.store.claim({ handle, tokenHash: hash, name, face, cap: deps.cap });
  if (answer.outcome === "handle taken") return { ok: false, status: 409, message: "That handle belongs to another browser. Pick another one." };
  if (answer.outcome === "face taken") return { ok: false, status: 409, message: "Somebody took that face first. Pick another one." };
  if (answer.outcome === "pit full") return { ok: false, status: 409, message: "Every claimable seat is taken right now. Try again after a round or two." };

  const fighter = answer.fighter!;
  return {
    ok: true,
    view: {
      fighter: shown(fighter),
      freeFaces: deps.store.freeFaces(),
      message:
        answer.outcome === "already claimed"
          ? `${fighter.name} is already yours, and enters every round.`
          : `${fighter.name} is yours. It enters every round from the next one.`,
    },
  };
}
