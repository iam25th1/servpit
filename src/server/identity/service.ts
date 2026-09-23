// What a browser is told about a handle before it commits to one.
//
// Read only. Nothing here binds a handle: the claim still happens where it
// always did, on the first pick or the first pull, under the append lock. The
// point of asking first is that a visitor who picks a name somebody else
// holds finds out while the field is still in front of them, with names they
// can actually take, instead of finding out later from a refused write with
// no way back.
//
// Because it is read only, it is safe to answer freely: a handle's state is
// already observable by trying to use it, and the suggestions are names
// nobody holds.

import { normaliseHandle } from "@/config/backing";
import { tokenHash, validToken } from "../backing/identity";
import { firstOwner, handleState, suggestionsFor, type HandleOwners, type HandleState } from "./handles";

export interface HandleView {
  /** The handle as it would be stored, or null when it is not one. */
  handle: string | null;
  /** free, yours or taken. Null when there was nothing to look up. */
  state: HandleState | null;
  /** One sentence a player can read. */
  message: string;
  /** Free names to take instead. Empty unless the handle is taken. */
  suggestions: string[];
}

export interface HandleDeps {
  /** Every log that can hold a claim, asked in order. */
  logs: readonly HandleOwners[];
}

/** Whether this handle is free, yours, or somebody else's, and what to do about it. */
export function lookUpHandle(input: { handle: unknown; token: unknown }, deps: HandleDeps): HandleView {
  const handle = normaliseHandle(input.handle);
  if (handle === null) {
    return { handle: null, state: null, message: "A handle is 3 to 16 letters, numbers, dashes or underscores.", suggestions: [] };
  }
  const token = validToken(input.token);
  if (token === null) {
    return { handle, state: null, message: "This browser has no token yet.", suggestions: [] };
  }

  const owners: HandleOwners = { owner: (name) => firstOwner(name, deps.logs) };
  const state = handleState(handle, tokenHash(token), owners);
  if (state === "taken") {
    return {
      handle,
      state,
      message: `${handle} belongs to another browser. Take one of these instead, or try another name.`,
      suggestions: suggestionsFor(handle, (candidate) => owners.owner(candidate) !== null),
    };
  }
  return {
    handle,
    state,
    message: state === "yours" ? `${handle} is yours on this browser.` : `${handle} is free.`,
    suggestions: [],
  };
}

/**
 * The owner of a handle across every log that can hold a claim.
 *
 * Three now: picks, pulls and fighters. One handle is one browser, and a
 * name claimed in any of them is claimed, which is the rule that was missing
 * when each log only ever asked itself.
 */
export function ownerAcross(logs: readonly HandleOwners[]): (handle: string) => string | null {
  return (handle) => firstOwner(handle, logs);
}
