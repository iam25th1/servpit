// The spot an agent was in when it decided.
//
// Recorded raw, bucketed at read time. Raw numbers because a bucketing that
// changes later must not invalidate the history: the buckets are a reading of
// the record, not the record itself. A round stored under last month's bands
// is still a round somebody reasoned about.
//
// What is here is what an agent's answer actually turns on: what it holds,
// what it owes, what is in the pot, how big the field is, and how its last
// few rounds went. Everything else about a round is the same for all six.
//
// Arithmetic only. Nothing here reaches a model, a wallet or a network.

import { toChips } from "@/config/stake";
import type { AgentSnapshot, RoundContext } from "./types";

/** How many recent rounds count as a record. The same window the prompt sees. */
export const RECORD_ROUNDS = 5;

/** The spot, as numbers, exactly as it was. */
export interface Situation {
  /** What the wallet held, in chips. */
  balanceChips: number;
  /** What it owed the lender, in chips. Zero with the bank off. */
  debtChips: number;
  /** What the pot was worth, in chips. */
  potChips: number;
  /** How many were in the field. */
  field: number;
  /** How many of the last few rounds it entered. */
  recentEntered: number;
  /** How many of those it came out of ahead. */
  recentAhead: number;
}

export function situationOf(snapshot: AgentSnapshot, round: RoundContext): Situation {
  const recent = snapshot.recentOutcomes.slice(-RECORD_ROUNDS);
  return {
    balanceChips: toChips(snapshot.balanceWei),
    debtChips: toChips(snapshot.debtWei ?? 0n),
    potChips: toChips(round.poolWei),
    field: round.participants,
    recentEntered: recent.filter((o) => o.entered).length,
    recentAhead: recent.filter((o) => o.netWei > 0n).length,
  };
}

/**
 * The bands a situation is matched on.
 *
 * Coarse on purpose. The point is to find rounds that are the same kind of
 * spot, not the same spot: an agent holding 91 chips and one holding 94 are
 * in the same position and there will never be enough rounds to match them
 * exactly. Each band is named here rather than computed from a range, so what
 * counts as the same spot is a decision somebody made rather than a side
 * effect of arithmetic.
 *
 * Balance is in multiples of the seat price, which is what actually decides
 * whether an agent can play: under one seat, one to three, three to ten, ten
 * to thirty, or deep. Debt is none, some or heavy against the balance. The
 * pot is small, ordinary or large against the field. The field is thin, full
 * or overfull. The record is how many of the last five it entered and how
 * many of those it came out of ahead, kept as counts because five rounds is
 * already coarse.
 */
export function bandOf(situation: Situation, stakeChips: number): string {
  const seats = stakeChips > 0 ? situation.balanceChips / stakeChips : 0;
  const balance = seats < 1 ? "broke" : seats < 3 ? "thin" : seats < 10 ? "steady" : seats < 30 ? "deep" : "rich";

  const owed = situation.balanceChips > 0 ? situation.debtChips / situation.balanceChips : situation.debtChips > 0 ? 9 : 0;
  const debt = situation.debtChips === 0 ? "clear" : owed < 0.5 ? "owing" : "sunk";

  const perSeat = situation.field > 0 ? situation.potChips / situation.field : 0;
  const pot = perSeat < stakeChips ? "small" : perSeat < stakeChips * 2 ? "ordinary" : "large";

  const field = situation.field <= 12 ? "thin" : situation.field <= 24 ? "full" : "packed";

  return [balance, debt, pot, field, `in${situation.recentEntered}`, `up${situation.recentAhead}`].join("/");
}
