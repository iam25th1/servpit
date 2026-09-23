// What a fighter did in one round, read off the round that was recorded.
//
// Nothing new is counted here. The placements are the order the round ended
// in and the kills are the death events the log already carries: a death
// names who died and who killed them, so a fighter's kills are the deaths
// whose killer was that fighter. No new mechanism, no second source, and
// nothing that could disagree with the replay a viewer can watch.
//
// A word about the streak, because it is the one figure that needed a
// decision. Everybody but the winner dies in a battle royale, so a streak of
// survivals would be a streak of wins under another name. What is counted is
// outlasting the field: a round counts when the fighter finished in the top
// half of it, which is the ordinary meaning of having done well without
// having won.
//
// Arithmetic only. Nothing here reaches a wallet, a chain or a model.

/** The slice of a round this file reads. */
export interface RoundOutcomeInput {
  /** Entrant ids, winner first, in the order the round ended. */
  placements: readonly string[];
  /** The event log, exactly as it was recorded. */
  log: ReadonlyArray<{ type: string; actor: string; target: string | null }>;
}

/** What one fighter did in one round. */
export interface FighterRound {
  handle: string;
  entrantId: string;
  /** One for the winner. Zero when the fighter was not in this round. */
  placement: number;
  /** How many of this round's deaths this fighter caused. */
  kills: number;
  /** True for the winner. */
  won: boolean;
  /** True when it finished in the top half of the field. */
  outlasted: boolean;
}

/** What one fighter did in one round, or null when it was not in it. */
export function roundFor(handle: string, entrantId: string, round: RoundOutcomeInput): FighterRound | null {
  const index = round.placements.indexOf(entrantId);
  if (index === -1) return null;
  const placement = index + 1;
  const field = round.placements.length;
  let kills = 0;
  for (const event of round.log) {
    if (event.type === "death" && event.target === entrantId) kills += 1;
  }
  return {
    handle,
    entrantId,
    placement,
    kills,
    won: placement === 1,
    // Top half, counted the way a person would: in a field of 24, finishing
    // twelfth or better.
    outlasted: placement * 2 <= field,
  };
}

/** What every claimed seat in a round did, in the order they were seated. */
export function roundsFor(
  fighters: ReadonlyArray<{ handle: string; entrantId: string }>,
  round: RoundOutcomeInput,
): FighterRound[] {
  const out: FighterRound[] = [];
  for (const fighter of fighters) {
    const row = roundFor(fighter.handle, fighter.entrantId, round);
    if (row) out.push(row);
  }
  return out;
}
