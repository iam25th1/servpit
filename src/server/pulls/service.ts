// The rules an ask has to pass, in one place the route and the tests share.
//
// What comes back is the same whatever happens next: the ask landed, or it
// did not and here is why. Nothing about the round travels back down this
// path. No round id, no seed, no plan, no draw, no placements and no winner,
// because the resolver is deterministic and a viewer who can see any of that
// before the fight is a viewer who already knows how it ends.
//
// Whether the pit is free to play is read from the arena store, not from the
// request, so a client that sends its own phase changes nothing.

import { normaliseHandle } from "@/config/backing";
import type { ArenaState } from "../arena/state";
import { tokenHash, validToken } from "../backing/identity";
import type { PullStore } from "./log";

/** What a caller is told, and all they are told. */
export interface PullView {
  /** True when the ask is now waiting for the worker. */
  queued: boolean;
  /** One sentence a player can read. */
  message: string;
}

export type PullAnswer = { ok: true; view: PullView } | { ok: false; status: number; message: string };

export interface PullInput {
  handle: unknown;
  token: unknown;
}

export interface PullDeps {
  store: PullStore;
  arenaMode: boolean;
  /** The handle owner from the pick log, so one handle is one browser everywhere. */
  backingOwner?: (handle: string) => string | null;
  now?: () => number;
}

/** True while the pit is busy with a round, which is most of a round. */
export function roundInFlight(state: ArenaState): boolean {
  const phase = state.round?.phase;
  if (phase === undefined) return false;
  return phase !== "resting" && phase !== "failed";
}

/**
 * Takes an ask for a round, or says plainly why it was not taken.
 *
 * The order is what is wrong with the request before what is wrong with the
 * moment, so somebody fixing a handle is not also told the pit is busy.
 */
export function requestPull(state: ArenaState, input: PullInput, deps: PullDeps): PullAnswer {
  if (!deps.arenaMode) return { ok: false, status: 403, message: "The lever starts rounds here. The pit is not running itself." };

  const handle = normaliseHandle(input.handle);
  if (handle === null) return { ok: false, status: 400, message: "A handle is 3 to 16 letters, numbers, dashes or underscores." };
  const token = validToken(input.token);
  if (token === null) return { ok: false, status: 400, message: "This browser has no token yet." };
  const hash = tokenHash(token);

  const backingOwner = deps.backingOwner?.(handle) ?? null;
  if (backingOwner !== null && backingOwner !== hash) {
    return { ok: false, status: 409, message: "That handle belongs to another browser. Pick another one." };
  }

  if (roundInFlight(state)) return { ok: false, status: 409, message: "A round is already running. This one plays out first." };

  const asked = deps.store.request(handle, hash);
  if (asked.outcome === "handle taken") return { ok: false, status: 409, message: "That handle belongs to another browser. Pick another one." };
  if (asked.outcome === "already asked") return { ok: false, status: 409, message: "Somebody just pulled it. That round is starting now." };

  return { ok: true, view: { queued: true, message: "The pit heard you. The round starts in a moment." } };
}
