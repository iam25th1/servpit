// What a viewer is looking at, worked out from the phase the pit is in.
//
// Pure, so the whole mapping is testable without a browser: the arena view
// goes in, the screen the shell should show and the shapes it already knows
// how to draw come out. Nothing here fetches, animates or touches a canvas.
//
// The screens are the ones the lever flow already uses. A spectator watching
// agents decide is looking at the lineup; watching entries confirm is the buy
// in panel; watching the fight is the arena. Only the quiet between rounds is
// new, because the lever flow never has any.

import type { ArenaPhase } from "@/server/arena/state";
import type { DecidedShape, OccupantShape } from "./screens/lineupRows";
import type { EntryShape } from "./screens/GameShell";

/** The slice of the arena payload this file reads. Mirrors the endpoint. */
export interface ArenaFeedRound {
  roundId: string;
  startedAt: string;
  phase: ArenaPhase;
  phases: Array<{ phase: ArenaPhase; at: string; durationMs?: number; reason?: string }>;
  network: string;
  backend: string;
  entrants: number;
  bots: number;
  stakeChips: number;
  weiPerChip: string;
  decisions: Array<{ agentId: string; name: string; face: string | null; enter: boolean; stake: number; reason: string; source: string; balance: number; debt: number }>;
  loans: Array<{ agentId: string; name: string; asked: number; amount: number; rateBps: number; reason: string; source: string }>;
  refusals: Array<{ agentId: string; name: string; asked: number; reason: string; source: string }>;
  bank: { treasury: number; book: Array<{ agentId: string; name: string; owed: number; principal: number; rateBps: number }> } | null;
  entries: Array<{ agentId: string; amountWei: string; txHash: string | null; link: string | null }>;
  reels?: Array<{ entrantId: string; symbols: string[]; characterId: string; tier: string; combo: string; bonusPct: number }>;
  fight?: { seed: string; durationMs: number; characters: unknown[]; log: unknown[]; placements: string[]; names: Record<string, string> };
  result?: Record<string, unknown>;
}

export interface ArenaFeedView {
  pit: { network: string; backend: string; paused: boolean; nextRoundAt: string | null; updatedAt: string };
  round: ArenaFeedRound | null;
  last: ArenaFeedRound | null;
}

/** The shell's own screens, which arena mode reuses rather than replaces. */
export type WatchScreen = "lobby" | "spinning" | "arena" | "result" | "resting";

export interface WatchState {
  screen: WatchScreen;
  /** The round being shown: the live one, or the last one while resting. */
  round: ArenaFeedRound | null;
  /** True while the pit is between rounds rather than playing one. */
  resting: boolean;
  /** Why it is resting, in the worker's own words. Null while it is playing. */
  restReason: string | null;
  /** When the next round is due, for the countdown. */
  nextRoundAt: string | null;
  paused: boolean;
}

const SCREEN_FOR: Record<ArenaPhase, WatchScreen> = {
  planning: "lobby",
  deciding: "lobby",
  banking: "lobby",
  settling: "spinning",
  reels: "spinning",
  fight: "arena",
  result: "result",
  resting: "resting",
  failed: "resting",
};

/** The last mark for a phase, which is where its clock started. */
export function phaseMark(round: ArenaFeedRound | null, phase: ArenaPhase): { at: string; durationMs?: number; reason?: string } | null {
  if (!round) return null;
  for (let i = round.phases.length - 1; i >= 0; i--) {
    if (round.phases[i].phase === phase) return round.phases[i];
  }
  return null;
}

export function watchState(view: ArenaFeedView | null): WatchState {
  if (!view || !view.round) {
    return { screen: "resting", round: view?.last ?? null, resting: true, restReason: null, nextRoundAt: view?.pit.nextRoundAt ?? null, paused: view?.pit.paused ?? false };
  }
  const round = view.round;
  const screen = SCREEN_FOR[round.phase];
  const resting = screen === "resting";
  // Between rounds the round on screen is the one that just finished, and the
  // live copy of it carries no result: a round that is still going must not,
  // so the projection strips it from every phase but the fight and the
  // result. The finished copy is kept whole in last, which is where the card
  // that names a winner reads it from.
  const shown = resting && view.last && view.last.roundId === round.roundId ? view.last : round;
  return {
    screen,
    round: shown,
    resting,
    restReason: resting ? (phaseMark(round, round.phase)?.reason ?? null) : null,
    nextRoundAt: view.pit.nextRoundAt,
    paused: view.pit.paused,
  };
}

/**
 * How far into the fight a viewer arriving now should be.
 *
 * The worker publishes when the fight started and how long it runs, so every
 * viewer computes the same offset from the same two numbers rather than
 * starting at zero whenever they happen to load the page. Clamped to the
 * duration, because a clock that is a little ahead must not seek past the end.
 */
export function fightOffsetMs(round: ArenaFeedRound | null, now: number): number | null {
  if (!round?.fight) return null;
  const mark = phaseMark(round, "fight");
  if (!mark) return null;
  const startedAt = Date.parse(mark.at);
  if (!Number.isFinite(startedAt)) return null;
  const elapsed = now - startedAt;
  if (elapsed <= 0) return 0;
  return Math.min(elapsed, round.fight.durationMs);
}

/** Seconds until the next round, or null when nothing is scheduled. */
export function secondsUntil(at: string | null, now: number): number | null {
  if (!at) return null;
  const when = Date.parse(at);
  if (!Number.isFinite(when)) return null;
  return Math.max(0, Math.round((when - now) / 1000));
}

/** The decisions, in the shape the lineup already draws. */
export function watchDecisions(round: ArenaFeedRound | null): DecidedShape[] {
  if (!round) return [];
  return round.decisions.map((d) => ({
    agentId: d.agentId,
    name: d.name,
    enter: d.enter,
    stake: d.stake,
    reason: d.reason,
    balance: d.balance,
    debt: d.debt,
    face: d.face,
    source: d.source === "serv" ? "serv" : "heuristic",
  }));
}

/** Who is in each seat, for the rows that have not reported yet. */
export function watchOccupants(round: ArenaFeedRound | null): OccupantShape[] {
  if (!round) return [];
  return round.decisions.map((d) => ({ agentId: d.agentId, name: d.name, face: d.face }));
}

/** The buy ins, in the shape the buy in panel already draws. */
export function watchEntries(round: ArenaFeedRound | null): EntryShape[] {
  if (!round) return [];
  return round.entries.map((e) => ({
    agentId: e.agentId,
    name: round.decisions.find((d) => d.agentId === e.agentId)?.name ?? e.agentId,
    amountWei: e.amountWei,
    txHash: e.txHash,
    link: e.link,
    applied: true,
  }));
}
