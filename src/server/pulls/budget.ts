// What reasoning has actually cost today.
//
// Measured, not estimated. Every round already records the calls it made and
// what they came to, in micro cents, because the settle path reports cost;
// the budget is arithmetic over the rounds of the last day. An estimate from
// a rate would drift from the bill, and the thing being protected is the
// bill.
//
// Arithmetic only. Nothing here reaches a network or a wallet.

import { DAY_MS } from "@/config/pulls";
import type { StoredRound } from "../round/store";

/** A hundredth of a cent times ten thousand, which is how a round records it. */
export const MICRO_CENTS_PER_CENT = 1_000_000;

/** What the rounds of the last day spent on reasoning, in micro cents. */
export function spentSince(rounds: readonly StoredRound[], since: number): number {
  let total = 0;
  for (const round of rounds) {
    const at = Date.parse(round.createdAt);
    if (!Number.isFinite(at) || at < since) continue;
    total += round.servMicroCents ?? 0;
  }
  return total;
}

export interface BudgetState {
  /** Spent in the last day, in micro cents. */
  spentMicroCents: number;
  /** The allowance, in micro cents. */
  budgetMicroCents: number;
  /** True while there is anything left to spend. */
  withinBudget: boolean;
}

/**
 * Where the day's spend stands against the allowance.
 *
 * A rolling day rather than a calendar one: a calendar day resets at a moment
 * somebody can wait for, and a rolling day cannot be gamed by waiting for
 * midnight in a timezone the operator does not live in.
 */
export function budgetState(rounds: readonly StoredRound[], dailyBudgetCents: number, now: number): BudgetState {
  const spentMicroCents = spentSince(rounds, now - DAY_MS);
  const budgetMicroCents = Math.max(0, dailyBudgetCents) * MICRO_CENTS_PER_CENT;
  return { spentMicroCents, budgetMicroCents, withinBudget: spentMicroCents < budgetMicroCents };
}
