// The rules an ask has to pass, in one place the route and the tests share.
//
// What comes back is the same whatever happens next: what the lever can do
// for this browser right now, and whether the ask landed. Nothing about the
// round travels back down this path. No round id, no seed, no plan, no draw,
// no placements and no winner, because the resolver is deterministic and a
// viewer who can see any of that before the fight is a viewer who already
// knows how it ends.
//
// Three limits stand between a public button and the operator's account, and
// they protect different things. Per browser, because one person should not
// be able to spend the day's reasoning on their own. Per hour across
// everybody, because a round is chain fees and every round can wreck an agent
// the operator then replaces. And a daily budget measured from what rounds
// actually recorded, because reasoning is the part that costs money per call.
//
// The budget never refuses a round. It turns reasoning off for it and says
// so, which is exactly what a scheduled round does all day.

import { normaliseHandle } from "@/config/backing";
import { HOUR_MS } from "@/config/pulls";
import type { ArenaState } from "../arena/state";
import { tokenHash, validToken } from "../backing/identity";
import type { BudgetState } from "./budget";
import type { PullStore } from "./log";
import type { PullSettings } from "./settings";

/** What a viewer is told about the lever, and all they are told. */
export interface PullView {
  /** True when the ask is now waiting for the worker. */
  queued: boolean;
  /** One sentence a player can read. */
  message: string;
  /** Asks this browser has left in the window, or null when there is no limit. */
  left: number | null;
  /** When the oldest ask in the window ages out, so a client can count down. */
  resetsAt: string | null;
  /** Whether a round pulled now would reason, stated before pulling. */
  willReason: boolean;
  /** Why it would not, in plain words, or null when it would. */
  reasonBlocked: string | null;
}

export type PullAnswer = { ok: true; view: PullView } | { ok: false; status: number; message: string };

export interface PullInput {
  handle: unknown;
  token: unknown;
}

export interface PullDeps {
  store: PullStore;
  arenaMode: boolean;
  settings: PullSettings;
  /** The day's reasoning spend against the allowance, measured from the rounds. */
  budget: BudgetState;
  /** True while the operator switch allows reasoning at all. */
  reasoningOn: boolean;
  /**
   * Whether this deployment has reasoning configured at all.
   *
   * A pit with no key cannot reason however the switch is set, and a lever
   * that promised it would be promising something nobody could deliver.
   */
  reasoningConfigured?: boolean;
  /** The handle owner from the pick log, so one handle is one browser everywhere. */
  backingOwner?: (handle: string) => string | null;
  /** Whether this request's place in the world may pull. Already keyed to it. */
  crowd?: () => boolean;
  now?: () => number;
}

/** True while the pit is busy with a round, which is most of a round. */
export function roundInFlight(state: ArenaState): boolean {
  const phase = state.round?.phase;
  if (phase === undefined) return false;
  return phase !== "resting" && phase !== "failed";
}

/** Whether a round pulled right now would reason, and why not when it would not. */
export function reasoningOutlook(deps: Pick<PullDeps, "budget" | "reasoningOn" | "reasoningConfigured">): { willReason: boolean; reasonBlocked: string | null } {
  if (deps.reasoningConfigured === false) return { willReason: false, reasonBlocked: "This pit has no reasoning configured, so every round runs on instinct." };
  if (!deps.reasoningOn) return { willReason: false, reasonBlocked: "The operator has reasoning switched off, so this round runs on instinct." };
  if (!deps.budget.withinBudget) return { willReason: false, reasonBlocked: "The pit has spent its reasoning budget for today, so this round runs on instinct." };
  return { willReason: true, reasonBlocked: null };
}

/** What this browser has left, and when the window gives some back. */
function allowance(hash: string, deps: PullDeps, now: number): { left: number | null; resetsAt: string | null; windowStart: number } {
  const windowMs = deps.settings.windowHours * HOUR_MS;
  const windowStart = now - windowMs;
  if (deps.settings.perIdentity === null) return { left: null, resetsAt: null, windowStart };
  const used = deps.store.asksSince(hash, windowStart);
  const oldest = deps.store.oldestAskSince(hash, windowStart);
  return {
    left: Math.max(0, deps.settings.perIdentity - used),
    resetsAt: oldest === null ? null : new Date(oldest + windowMs).toISOString(),
    windowStart,
  };
}

/** The lever as it stands for this browser, without asking for anything. */
export function pullStatus(state: ArenaStateLike, input: { handle: unknown; token: unknown }, deps: PullDeps): PullView {
  const now = (deps.now ?? Date.now)();
  const outlook = reasoningOutlook(deps);
  const handle = normaliseHandle(input.handle);
  const token = validToken(input.token);
  if (handle === null || token === null) {
    return { queued: false, message: "Pull the lever to start a round.", left: deps.settings.perIdentity, resetsAt: null, ...outlook };
  }
  const { left, resetsAt } = allowance(tokenHash(token), deps, now);
  return { queued: false, message: "Pull the lever to start a round.", left, resetsAt, ...outlook };
}

/** The bits of the arena state this file reads. Narrow on purpose. */
type ArenaStateLike = ArenaState;

/**
 * Takes an ask for a round, or says plainly why it was not taken.
 *
 * The order is what is wrong with the request, then what the operator allows,
 * then what the moment allows, so somebody fixing a handle is not also told
 * the pit is busy, and somebody out of pulls is not told to come back when
 * the round ends.
 */
export function requestPull(state: ArenaStateLike, input: PullInput, deps: PullDeps): PullAnswer {
  const now = (deps.now ?? Date.now)();
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

  const { left, resetsAt } = allowance(hash, deps, now);
  if (left !== null && left <= 0) {
    const when = resetsAt === null ? "later" : `after ${new Date(resetsAt).toISOString()}`;
    return { ok: false, status: 429, message: `That is your ${deps.settings.perIdentity} pulls for now. The next one is ${when}.` };
  }
  // The allowance above is kept in the log under a token the browser made
  // for itself, so it counts nothing against somebody presenting a new one
  // every time. This counts where the request came from instead.
  if (deps.crowd !== undefined && !deps.crowd()) {
    return { ok: false, status: 429, message: "The lever has been pulled a lot from where you are. Give it a while." };
  }

  if (deps.store.takenSince(now - HOUR_MS) >= deps.settings.perHour) {
    return { ok: false, status: 429, message: `The lever has started ${deps.settings.perHour} rounds this hour, which is its limit. The pit keeps playing on its own.` };
  }

  if (roundInFlight(state)) return { ok: false, status: 409, message: "A round is already running. This one plays out first." };

  const asked = deps.store.request(handle, hash);
  if (asked.outcome === "handle taken") return { ok: false, status: 409, message: "That handle belongs to another browser. Pick another one." };
  if (asked.outcome === "already asked") return { ok: false, status: 409, message: "Somebody just pulled it. That round is starting now." };

  const after = allowance(hash, deps, now);
  const outlook = reasoningOutlook(deps);
  return {
    ok: true,
    view: {
      queued: true,
      message: outlook.willReason
        ? "The pit heard you. The agents reason about this one."
        : "The pit heard you. This round runs on instinct.",
      left: after.left,
      resetsAt: after.resetsAt,
      ...outlook,
    },
  };
}
