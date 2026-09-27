// Calling the agents: the game a visitor plays between rounds.
//
// Before a round starts, a visitor calls each agent in or out: will it buy a
// seat or hold its chips? The round then decides for real, and a call is
// right when the agent did what it was called to do. A call on a decision
// SERV reasoned is worth double, because reading a model is the point of the
// pit, and a visitor who calls every seat right gets a bonus on top.
//
// Points, never money. Nothing here touches a wallet, and nothing a visitor
// calls changes what an agent does: the calls are locked before the round
// starts and the agents never see them.
//
// Here rather than on the server because the result screen scores a read too,
// from the same decisions, so what a viewer is told and what the board records
// cannot drift. Pure, integer arithmetic and no clock.

/** Points for a right call on a decision made on instinct or learned from the record. */
export const READ_POINTS = 10;
/** Points for a right call on a decision SERV reasoned. */
export const REASONED_READ_POINTS = 20;
/** On top, for calling every seat and getting every one right. */
export const PERFECT_READ_BONUS = 50;
/** How many times a minute one browser may change its calls. */
export const CALLS_PER_MINUTE = 20;

/** A visitor's calls: seat id to true for in, false for out. */
export type Calls = Record<string, boolean>;

/**
 * The calls as they are stored, or null when they are not calls.
 *
 * Only the seats the pit has, only true or false, and at least one of them. A
 * seat nobody called is left out rather than guessed, so calling three agents
 * is a read of three agents, and the perfect bonus asks for all of them.
 */
export function normaliseCalls(raw: unknown, seats: readonly string[]): Calls | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const known = new Set(seats);
  const calls: Calls = {};
  for (const [seat, call] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(seat) || typeof call !== "boolean") return null;
    calls[seat] = call;
  }
  return Object.keys(calls).length > 0 ? calls : null;
}

/** What a round decided, as far as calls are concerned. */
export interface ReadOutcome {
  /** Every seat in the pit, which is what a perfect read has to cover. */
  seats: readonly string[];
  /** The seats whose agent bought in, after every exclusion. */
  entered: ReadonlySet<string>;
  /** The seats whose decision came from SERV rather than instinct or the record. */
  reasoned: ReadonlySet<string>;
}

/** One decision, reduced to what a read is scored on. */
export interface DecisionLike {
  agentId: string;
  enter: boolean;
  source: string;
}

/**
 * What a round decided, from its final decisions.
 *
 * The final ones, after the chain's own check: an agent that said yes and was
 * turned away for its balance did not buy in, and a call of out on it was
 * right. A seat with no decision at all did not buy in either.
 */
export function readOutcome(decisions: readonly DecisionLike[], seats: readonly string[]): ReadOutcome {
  return {
    seats,
    entered: new Set(decisions.filter((d) => d.enter).map((d) => d.agentId)),
    reasoned: new Set(decisions.filter((d) => d.source === "serv").map((d) => d.agentId)),
  };
}

/** How one seat's call went. */
export interface SeatRead {
  call: boolean;
  right: boolean;
  points: number;
}

/** How a whole read went. */
export interface ReadResult {
  called: number;
  right: number;
  /** Every seat called and every call right. */
  perfect: boolean;
  points: number;
  seats: Record<string, SeatRead>;
}

/** Scores one visitor's calls against what the round decided. */
export function scoreRead(calls: Calls, outcome: ReadOutcome): ReadResult {
  const seats: Record<string, SeatRead> = {};
  let right = 0;
  let points = 0;
  let called = 0;
  for (const seat of outcome.seats) {
    if (!(seat in calls)) continue;
    called += 1;
    const call = calls[seat] === true;
    const correct = call === outcome.entered.has(seat);
    const worth = correct ? (outcome.reasoned.has(seat) ? REASONED_READ_POINTS : READ_POINTS) : 0;
    if (correct) right += 1;
    points += worth;
    seats[seat] = { call, right: correct, points: worth };
  }
  const perfect = called === outcome.seats.length && right === called && called > 0;
  if (perfect) points += PERFECT_READ_BONUS;
  return { called, right, perfect, points, seats };
}

/** The sentence a viewer reads about their read, once a round has decided. */
export function readLine(result: ReadResult): string {
  if (result.called === 0) return "";
  if (result.perfect) return `You read all ${result.called} right. ${result.points} points, bonus included.`;
  if (result.right === 0) return `You read none of your ${result.called} calls right this time.`;
  return `You read ${result.right} of ${result.called} right, for ${result.points} points.`;
}
