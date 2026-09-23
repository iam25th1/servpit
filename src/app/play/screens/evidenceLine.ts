// What a learned decision was drawn from, in a sentence.
//
// A learned line is the pit repeating a pattern, and a viewer is owed the
// pattern: how many reasoned rounds in this kind of spot, how many of them
// the model entered, and what it usually put up. Nothing about how those
// rounds ended, because the learner never read that and a sentence that
// mentioned it would imply otherwise.

export interface Evidence {
  matches: number;
  entered: number;
  typicalStake: number;
}

/**
 * The sentence under a learned decision, or null when there is nothing to say.
 *
 * The stake is given in seats as well as chips when it is more than one,
 * because a seat is the unit the round is priced in and a multiple is what a
 * reader compares against the others.
 */
export function evidenceLine(evidence: Evidence | undefined | null, stakeChips: number): string | null {
  if (!evidence || evidence.matches <= 0) return null;
  const rounds = `${evidence.matches} reasoned round${evidence.matches === 1 ? "" : "s"} in spots like this`;
  const entered = `SERV entered in ${evidence.entered}`;
  if (evidence.entered === 0) return `Learned from ${rounds}. ${entered}.`;
  const seats = stakeChips > 0 ? evidence.typicalStake / stakeChips : 0;
  const stake = seats >= 2 && Number.isInteger(seats) ? `typical stake ${seats}x` : `typical stake ${evidence.typicalStake} chips`;
  return `Learned from ${rounds}. ${entered}, ${stake}.`;
}

/** The one line the pit says about its own record, or null before it has one. */
export function recordLine(reasonedRounds: number | undefined): string | null {
  if (!reasonedRounds || reasonedRounds <= 0) return null;
  return `The pit has ${reasonedRounds} reasoned round${reasonedRounds === 1 ? "" : "s"} to learn from.`;
}
