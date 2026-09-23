// Who a handle belongs to, and what to offer somebody whose choice is taken.
//
// A handle is a name on a board, not an account: the first browser to use one
// binds it to the hash of its device token, and every later use has to prove
// the same token. That rule was already here. What was missing was an answer
// for the visitor on the other side of it. Typing a name somebody else holds
// left the interface saying "backing as ash" over a server that refused every
// write under it, with no field to change and nothing to change it to.
//
// Two claims exist, one in the pick log and one in the pull log, and until
// now each checked only its own. That is not one handle to one browser: a
// name claimed by pulling the lever could still be picked under by somebody
// else, which this file's owner lookup closes by asking both.
//
// Arithmetic and string work only. Nothing here writes, and nothing here
// reaches a wallet, a chain or a model.

import { HANDLE_PATTERN, normaliseHandle } from "@/config/backing";

/** What a handle is, to the browser asking about it. */
export type HandleState = "free" | "yours" | "taken";

/** Every claim there is, asked in one place so neither log can disagree. */
export interface HandleOwners {
  /** The token hash that holds this handle, or null when nobody does. */
  owner(handle: string): string | null;
}

/**
 * Where a handle stands for this browser.
 *
 * Yours rather than taken when the hash matches, because coming back to your
 * own handle on your own browser is the ordinary case and must not read as a
 * refusal.
 */
export function handleState(handle: string, tokenHash: string, owners: HandleOwners): HandleState {
  const held = owners.owner(handle);
  if (held === null) return "free";
  return held === tokenHash ? "yours" : "taken";
}

/** The owner from several logs, where the first claim found wins. */
export function firstOwner(handle: string, logs: readonly HandleOwners[]): string | null {
  for (const log of logs) {
    const held = log.owner(handle);
    if (held !== null) return held;
  }
  return null;
}

/** How many alternatives to offer. Enough to choose from, few enough to read. */
export const SUGGESTION_COUNT = 3;

/**
 * Free handles near the one somebody wanted.
 *
 * Near, because a visitor who typed ash wants something like ash rather than
 * a random word: the first tries are the same name with a short suffix, and
 * only when those are gone does it fall back to numbers. Deterministic given
 * the same name and the same taken set, so the same visitor asking twice is
 * offered the same names rather than a shuffling list.
 *
 * Anything that would not pass the handle rule is skipped rather than
 * trimmed, so every suggestion is one that can actually be claimed.
 */
export function suggestionsFor(handle: string, taken: (candidate: string) => boolean, count: number = SUGGESTION_COUNT): string[] {
  const base = normaliseHandle(handle) ?? "fighter";
  const out: string[] = [];
  const offer = (candidate: string): void => {
    if (out.length >= count) return;
    if (!HANDLE_PATTERN.test(candidate)) return;
    if (out.includes(candidate) || candidate === base) return;
    if (taken(candidate)) return;
    out.push(candidate);
  };

  for (const suffix of ["-2", "-3", "_x", "-pit", "-one"]) offer(`${base.slice(0, 16 - suffix.length)}${suffix}`);
  for (let n = 2; n < 40 && out.length < count; n += 1) offer(`${base.slice(0, 16 - String(n).length)}${n}`);
  // A name so long or so contested that nothing near it is free still gets
  // something it can use.
  for (let n = 1; n < 200 && out.length < count; n += 1) offer(`fighter-${n}`);
  return out;
}
