// The rules a pick has to pass, in one place both routes share.
//
// Everything here is decided from the arena store rather than from the
// request. The round a pick lands in is the round the pit is playing, not one
// the client names, and the window is open only while the pit says it is and
// the clock agrees. A client that sends a round id, an old phase or a late
// pick changes nothing about any of that.
//
// Points only. Nothing in this path touches a wallet, a transfer or a prize:
// a pick is a line in a log and a number on a board.

import { PICKS_PER_MINUTE, normaliseHandle } from "@/config/backing";
import type { ArenaState } from "../arena/state";
import { tokenHash, validToken } from "./identity";
import { RateLimiter } from "./limit";
import type { PickStore } from "./picks";

/** What a viewer sees about the window, whether or not they have picked. */
export interface BackingView {
  roundId: string | null;
  /** True only while the pit is in the backing phase and the clock agrees. */
  open: boolean;
  /** When the window shuts, so a client can count down to the same moment. */
  closesAt: string | null;
  /** Backers per agent id. The only thing a pick reveals about other viewers. */
  counts: Record<string, number>;
  /** How many have backed anybody at all. */
  backers: number;
  /** This handle's pick, when a handle was asked about. */
  pick: string | null;
}

export type PickAnswer = { ok: true; view: BackingView } | { ok: false; status: number; message: string };

export interface PickInput {
  handle: unknown;
  token: unknown;
  agentId: unknown;
}

export interface PickDeps {
  store: PickStore;
  limiter: RateLimiter;
  /** Whether this request's place in the world may write. Already keyed to it. */
  crowd?: () => boolean;
  arenaMode: boolean;
  /**
   * The handle's owner outside this log.
   *
   * One handle is one browser everywhere, and a handle claimed by pulling the
   * lever lives in the pull log rather than this one. Without this, a name
   * claimed there could still be picked under by somebody else, which is the
   * hole the handle flow was hiding.
   */
  otherOwner?: (handle: string) => string | null;
  now?: () => number;
}

/** The last backing mark, and when it closes. */
function window(state: ArenaState): { roundId: string; closesAt: number } | null {
  const round = state.round;
  if (!round || round.phase !== "backing") return null;
  const mark = [...round.phases].reverse().find((m) => m.phase === "backing");
  if (!mark) return null;
  const at = Date.parse(mark.at);
  if (!Number.isFinite(at)) return null;
  return { roundId: round.roundId, closesAt: at + (mark.durationMs ?? 0) };
}

/** Who may be backed: the agents that actually paid into this round. */
function entered(state: ArenaState): Set<string> {
  return new Set((state.round?.entries ?? []).map((e) => e.agentId));
}

export function backingView(state: ArenaState, store: PickStore, handle: string | null, now: () => number = Date.now): BackingView {
  const open = window(state);
  const roundId = state.round?.roundId ?? null;
  const counts = roundId ? store.countsFor(roundId) : {};
  const backers = roundId ? store.picksFor(roundId).size : 0;
  const normalised = handle === null ? null : normaliseHandle(handle);
  return {
    roundId,
    open: open !== null && now() <= open.closesAt,
    closesAt: open === null ? null : new Date(open.closesAt).toISOString(),
    counts,
    backers,
    pick: roundId && normalised ? store.pickOf(roundId, normalised) : null,
  };
}

/**
 * Takes a pick, or says plainly why it was not taken.
 *
 * The order is deliberate: what is wrong with the request before what is
 * wrong with the moment, so a viewer fixing a handle is not also told the
 * window is shut, and the rate limit before the write, so a flood costs a
 * lookup rather than a line on the disk.
 */
export function submitPick(state: ArenaState, input: PickInput, deps: PickDeps): PickAnswer {
  const now = deps.now ?? Date.now;
  if (!deps.arenaMode) return { ok: false, status: 403, message: "Backing is for live rounds the pit runs itself." };

  const handle = normaliseHandle(input.handle);
  if (handle === null) return { ok: false, status: 400, message: "A handle is 3 to 16 letters, numbers, dashes or underscores." };
  const token = validToken(input.token);
  if (token === null) return { ok: false, status: 400, message: "This browser has no backing token yet." };
  const agentId = typeof input.agentId === "string" ? input.agentId.trim() : "";

  const open = window(state);
  // Both the phase and the clock. The phase alone would let a pick land in
  // the moment between the window ending and the worker publishing the fight.
  if (open === null || now() > open.closesAt) return { ok: false, status: 409, message: "The backing window is closed for this round." };
  if (!entered(state).has(agentId)) return { ok: false, status: 400, message: "Back one of the agents that bought into this round." };

  const hash = tokenHash(token);
  const elsewhere = deps.otherOwner?.(handle) ?? null;
  if (elsewhere !== null && elsewhere !== hash) {
    return { ok: false, status: 409, message: "That handle belongs to another browser. Pick another one." };
  }
  if (!deps.limiter.allow(hash)) return { ok: false, status: 429, message: "That is a lot of picks. Give it a moment." };
  // And by where the request came from, because the token above is one the
  // browser made for itself and a fresh one is free.
  if (deps.crowd !== undefined && !deps.crowd()) return { ok: false, status: 429, message: "That is a lot of picks from one place. Give it a moment." };

  const outcome = deps.store.record(open.roundId, handle, hash, agentId);
  if (outcome === "handle taken") return { ok: false, status: 409, message: "That handle belongs to another browser. Pick another one." };
  if (outcome === "round full") return { ok: false, status: 429, message: "This round has all the backers it can hold. The next one is yours." };

  return { ok: true, view: backingView(state, deps.store, handle, now) };
}

/** The limiter for this process, since a limit per request would limit nothing. */
export const pickLimiter = new RateLimiter(PICKS_PER_MINUTE);
