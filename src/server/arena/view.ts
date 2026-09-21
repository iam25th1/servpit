// What a viewer is allowed to see, and when.
//
// The resolver is deterministic: the same seed and the same entrants always
// produce the same fight. So the seed IS the winner, the event log IS the
// winner, and the placements are the winner written out. None of them may
// appear in a response before the fight is being shown, or a viewer with a
// terminal knows the result while the agents are still deciding, and anything
// built on watching the round is built on nothing.
//
// Reel results are fine. They pick a fighter's character, and the character
// does not decide the fight: the resolver runs the same way whoever is in it.
//
// This is the one place that decides. The worker also refuses to write the
// outcome into the store before the fight phase, so there are two nets, and
// this one is the one that would still hold if the other tore.

import type { ArenaPhase, ArenaRound, ArenaState } from "./state";

/** Phases where the fight is being shown or is over. */
const OUTCOME_VISIBLE: ReadonlySet<ArenaPhase> = new Set<ArenaPhase>(["fight", "result"]);

export interface ArenaRoundView extends Omit<ArenaRound, "fight" | "result"> {
  fight?: ArenaRound["fight"];
  result?: ArenaRound["result"];
}

export interface ArenaView {
  pit: {
    network: string;
    backend: string;
    paused: boolean;
    nextRoundAt: string | null;
    updatedAt: string;
  };
  /** The round being played, or the last one if the pit is resting. */
  round: ArenaRoundView | null;
  /** The last round that finished. Over, so nothing in it is a spoiler. */
  last: ArenaRoundView | null;
}

/**
 * Strips a round back to what its phase allows.
 *
 * A round that has not reached the fight keeps everything a viewer needs to
 * watch it happen: who is in, what they said, what the lender said, what has
 * settled. It loses the fight and the result entirely, rather than losing
 * some fields of them, because a partial fight is still a spoiler.
 */
export function roundView(round: ArenaRound | null): ArenaRoundView | null {
  if (round === null) return null;
  if (OUTCOME_VISIBLE.has(round.phase)) return round;
  // Rebuilt field by field rather than by deleting two of them, so a field
  // added to a round later is not published here by default. Anything that
  // belongs to a viewer before the fight has to be named.
  return {
    roundId: round.roundId,
    startedAt: round.startedAt,
    phase: round.phase,
    phases: round.phases,
    network: round.network,
    backend: round.backend,
    entrants: round.entrants,
    bots: round.bots,
    stakeChips: round.stakeChips,
    weiPerChip: round.weiPerChip,
    decisions: round.decisions,
    loans: round.loans,
    refusals: round.refusals,
    bank: round.bank,
    entries: round.entries,
  };
}

export function arenaView(state: ArenaState, chain: { network: string; kind: string }): ArenaView {
  return {
    pit: {
      network: chain.network,
      backend: chain.kind,
      paused: state.paused,
      nextRoundAt: state.nextRoundAt,
      updatedAt: state.updatedAt,
    },
    round: roundView(state.round),
    // The last round is finished, so its fight and its result are history
    // rather than a spoiler, whatever phase the live one is in.
    last: state.last,
  };
}

/** What the stream sends on every phase change: small, and under the same rule. */
export function phaseEvent(view: ArenaView): {
  roundId: string | null;
  phase: ArenaPhase | null;
  at: string | null;
  durationMs: number | null;
  reason: string | null;
  paused: boolean;
  nextRoundAt: string | null;
} {
  const round = view.round;
  const mark = round?.phases.at(-1) ?? null;
  return {
    roundId: round?.roundId ?? null,
    phase: round?.phase ?? null,
    at: mark?.at ?? null,
    durationMs: mark?.durationMs ?? null,
    reason: mark?.reason ?? null,
    paused: view.pit.paused,
    nextRoundAt: view.pit.nextRoundAt,
  };
}
