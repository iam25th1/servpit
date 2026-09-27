// The rules a set of calls has to pass, in one place the route and the tests share.
//
// A visitor calls each agent in or out before a round starts. Everything that
// decides whether the calls are taken is read from the arena store rather
// than from the request: the round they are filed after is the round the pit
// has on file, and they are taken only while no round is being played. A
// client that sends its own round id or its own idea of the phase changes
// nothing about either.
//
// Points only. Nothing in this path touches a wallet, and nothing a visitor
// calls reaches an agent: the calls are lines in a log that the agents never
// read, scored once the round has decided.

import { NAMED_AGENTS } from "@/config/agents";
import { normaliseHandle } from "@/config/backing";
import { CALLS_PER_MINUTE, normaliseCalls, type Calls } from "@/config/reads";
import type { ArenaPhase, ArenaState } from "../arena/state";
import { tokenHash, validToken } from "../backing/identity";
import { RateLimiter } from "../backing/limit";
import type { PickStore } from "../backing/picks";

/** The seats a visitor may call: the six wallets, whoever is sitting in them. */
export const CALL_SEATS: readonly string[] = Object.freeze(NAMED_AGENTS.map((agent) => agent.id));

/** Phases in which no round is being decided, so a call cannot be a peek. */
const OPEN: ReadonlySet<ArenaPhase> = new Set<ArenaPhase>(["result", "resting", "failed"]);

/** What a viewer is told about calls, whether or not they have made any. */
export interface CallsView {
  /** True while calls on the next round are being taken. */
  open: boolean;
  /** This handle's calls on the next round, or null. */
  mine: Calls | null;
  /** How many visitors have called the next round so far. */
  callers: number;
  /**
   * The round on file and this handle's calls on it.
   *
   * While a round is being played these are the calls being scored against
   * it; once it is over they are the read the result screen and the quiet
   * screen talk about. Null when there is no round, or no calls on it.
   */
  round: { roundId: string; mine: Calls | null } | null;
}

export type CallsAnswer = { ok: true; view: CallsView } | { ok: false; status: number; message: string };

export interface CallsInput {
  handle: unknown;
  token: unknown;
  calls: unknown;
}

export interface CallsDeps {
  store: PickStore;
  limiter: RateLimiter;
  arenaMode: boolean;
  /** The handle's owner in the other logs, so one handle is one browser everywhere. */
  otherOwner?: (handle: string) => string | null;
}

/** Whether a round is being decided right now, which is when calls are locked. */
export function callsOpen(state: ArenaState): boolean {
  const round = state.round;
  return round === null || OPEN.has(round.phase);
}

/** The round new calls are filed after: the one on file, or nothing on a new pit. */
export function callKey(state: ArenaState): string {
  return state.round?.roundId ?? "";
}

/** The calls a round was scored against: this handle's, made before it started. */
function callsOnRound(state: ArenaState, store: PickStore, handle: string): CallsView["round"] {
  const round = state.round;
  if (!round || !round.roundId || round.after === undefined) return null;
  const started = Date.parse(round.startedAt);
  const mine = store.callsOf(round.after, handle, Number.isFinite(started) ? started : undefined);
  return mine === null ? null : { roundId: round.roundId, mine };
}

/**
 * What a viewer is told about calls.
 *
 * A handle's own calls only to the browser that owns it: the token has to
 * hash to the handle's claim. Calls on a round that has not started are a
 * visitor's read of it, and a handle anybody could look up would let one
 * player copy another's before the round locks. Everybody may see how many
 * have called.
 */
export function callsView(state: ArenaState, store: PickStore, handle: string | null, token?: unknown): CallsView {
  const open = callsOpen(state);
  const after = callKey(state);
  const normalised = handle === null ? null : normaliseHandle(handle);
  const presented = validToken(token);
  const owned = normalised !== null && presented !== null && store.owner(normalised) === tokenHash(presented);
  return {
    open,
    mine: open && owned ? store.callsOf(after, normalised) : null,
    callers: open ? store.callsAfter(after).size : 0,
    round: owned ? callsOnRound(state, store, normalised) : null,
  };
}

/**
 * Takes a visitor's calls, or says plainly why they were not taken.
 *
 * What is wrong with the request before what is wrong with the moment, and
 * the rate limit before the write, the same order a pick is checked in.
 */
export function submitCalls(state: ArenaState, input: CallsInput, deps: CallsDeps): CallsAnswer {
  if (!deps.arenaMode) return { ok: false, status: 403, message: "Calls are for the live pit." };

  const handle = normaliseHandle(input.handle);
  if (handle === null) return { ok: false, status: 400, message: "A handle is 3 to 16 letters, numbers, dashes or underscores." };
  const token = validToken(input.token);
  if (token === null) return { ok: false, status: 400, message: "This browser has no token yet." };
  const calls = normaliseCalls(input.calls, CALL_SEATS);
  if (calls === null) return { ok: false, status: 400, message: "Call at least one agent in or out." };

  if (!callsOpen(state)) return { ok: false, status: 409, message: "The agents are deciding. Calls open again when this round is over." };

  const hash = tokenHash(token);
  const elsewhere = deps.otherOwner?.(handle) ?? null;
  if (elsewhere !== null && elsewhere !== hash) {
    return { ok: false, status: 409, message: "That handle belongs to another browser. Pick another one." };
  }
  if (!deps.limiter.allow(hash)) return { ok: false, status: 429, message: "That is a lot of changes. Give it a moment." };

  const outcome = deps.store.recordCalls(callKey(state), handle, hash, calls);
  if (outcome === "handle taken") return { ok: false, status: 409, message: "That handle belongs to another browser. Pick another one." };

  return { ok: true, view: callsView(state, deps.store, handle, token) };
}

/** The limiter for this process, since a limit per request would limit nothing. */
export const callLimiter = new RateLimiter(CALLS_PER_MINUTE);
