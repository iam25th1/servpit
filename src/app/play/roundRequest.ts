// The body the client sends to settle the round it has already shown.
//
// This is a function rather than an inline object because getting it wrong is
// invisible: both requests succeed, both return a well formed round, and the
// screen looks right. The client used to ask /api/round/plan for a seed and
// then ask /api/round/run for plan.roundId.replace(/^r-/, "s"). The run route
// re-plans from whatever seed it is handed, so the decisions the player read
// and the transfers that settled belonged to two unrelated rounds. That is
// why the result screen showed three entries against a pot of 2400 and a
// winner nobody had seen decide.

export interface PlannedRound {
  roundId: string;
  seed: string;
}

export interface RunRequest {
  seed: string;
  entrants: number;
}

export function runRequestFor(plan: PlannedRound, entrants: number): RunRequest {
  if (plan.seed.length === 0) throw new RangeError("a plan with no seed cannot be settled");
  return { seed: plan.seed, entrants };
}
