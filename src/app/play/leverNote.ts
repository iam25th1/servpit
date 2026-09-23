// What the lever says about itself, in sentences rather than in fields.
//
// Pure, so every line a viewer can be shown is testable without a browser.
// The control renders these and decides nothing: whether a pull is allowed is
// the server's answer, and this only says what that answer means.

import type { PullView } from "./pullFeed";

export interface LeverLines {
  /** The label on the control. */
  action: string;
  /** Pulls left and when more arrive, or null when there is no limit. */
  pulls: string | null;
  /** Whether a round pulled now would reason. Always said before pulling. */
  reasoning: string;
  /** Why the lever will not work right now, or null when it will. */
  blocked: string | null;
  /** What the pit said when it took the ask, until the round starts. */
  said: string | null;
}

/** A gap in plain words, rounded the way somebody waiting would say it. */
export function inWords(ms: number): string {
  if (ms <= 0) return "any moment";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  return `in ${hours} hour${hours === 1 ? "" : "s"} ${rest} minute${rest === 1 ? "" : "s"}`;
}

export interface LeverState {
  view: PullView | null;
  error: string | null;
  pulling: boolean;
  /** True while the pit is playing a round, which is when a pull cannot land. */
  busy: boolean;
  /** This browser's handle, or null until one is chosen. */
  handle: string | null;
  now: number;
}

/**
 * Every line the control shows, worked out from what the pit last said.
 *
 * The reasoning line is never left out, because whether a round reasons is
 * the difference between the pit thinking and the pit running on instinct,
 * and a viewer deciding whether to spend one of their pulls on it should be
 * told before they pull rather than after.
 */
export function leverLines(state: LeverState): LeverLines {
  const { view } = state;
  const left = view?.left ?? null;
  const resetsAt = view?.resetsAt ? Date.parse(view.resetsAt) : Number.NaN;
  const reset = Number.isFinite(resetsAt) ? inWords(resetsAt - state.now) : null;

  const pulls =
    view === null
      ? null
      : left === null
        ? "Unlimited pulls."
        : left > 0
          ? `${left} pull${left === 1 ? "" : "s"} left${reset === null ? "" : `, one more ${reset}`}.`
          : `No pulls left${reset === null ? "" : `, the next ${reset}`}.`;

  const reasoning = view === null ? "" : view.willReason ? "The agents will reason about this round." : (view.reasonBlocked ?? "This round will run on instinct.");

  const blocked =
    state.error !== null
      ? state.error
      : state.handle === null
        ? "Choose a handle first, the same one you back under."
        : state.busy
          ? "A round is running. The lever comes back when it ends."
          : left !== null && left <= 0
            ? `No pulls left${reset === null ? "" : `, the next ${reset}`}.`
            : null;

  return {
    action: state.pulling ? "Pulling" : "Pull the lever",
    pulls,
    reasoning,
    blocked,
    // What the pit said when it took the ask. It stands until the round
    // starts, which is the pit answering in the only way that matters.
    said: view?.queued && !state.busy ? view.message : null,
  };
}
