// How each agent decides what to put up, and whether it will borrow to do it.
//
// Pure, and only the simulator uses it. The running game asks SERV, falls
// back to the deterministic heuristic, and stakes one fixed amount; this is
// the model of a field of agents with different appetites, so the design can
// be measured before any of it reaches a wallet.
//
// The strategies are the ones the roster already describes. The point of
// giving them different stakes is that a single field average tells you
// nothing: a wreck rate is only interesting if it falls on the agents that
// reached for it.

import type { StrategyId } from "@/config/agents";
import { clampStake } from "./prize";

export interface StakeContext {
  baseStakeWei: bigint;
  /** How many base stakes a seat may carry. */
  maxMultiple: number;
  balanceWei: bigint;
  /** Carried into this round, so a large pot is visible before it is won. */
  rolloverWei: bigint;
  /** Seats in the field, which with the base stake sets the cap worth chasing. */
  entrants: number;
  /** This agent's recent rounds, oldest first. */
  recent: readonly { entered: boolean; netWei: bigint }[];
  /** What the field put up last round on average. Nobody can see this round's. */
  fieldAverageWei: bigint;
}

export interface StakeIntent {
  stakeWei: bigint;
  /** Whether this agent will take a loan to reach that stake. */
  borrow: boolean;
}

/** Trailing wins, most recent first, stopping at the first round that was not one. */
function winStreak(recent: StakeContext["recent"]): number {
  let streak = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const round = recent[i];
    if (!round.entered || round.netWei <= 0n) break;
    streak += 1;
  }
  return streak;
}

/**
 * What this agent wants to put up, and whether it will borrow to get there.
 *
 * Every figure is clamped to the bounds before it is returned, so a
 * personality cannot put an agent outside them however it is written.
 */
export function stakeIntentFor(strategy: StrategyId, ctx: StakeContext): StakeIntent {
  const base = ctx.baseStakeWei;
  const ceiling = base * BigInt(ctx.maxMultiple);
  const clamp = (want: bigint): bigint => clampStake(base, ctx.maxMultiple, want);

  switch (strategy) {
    // Atlas. Preserves capital, and owes nobody anything ever.
    case "cautious":
      return { stakeWei: base, borrow: false };

    // Ember. Same seat every round, and borrows only to keep taking it.
    case "steady":
      return { stakeWei: base, borrow: true };

    // Blaze. Puts up the most it is allowed and does not mind owing for it.
    case "aggressive":
      return { stakeWei: ceiling, borrow: true };

    // Comet. Rides a streak: one more stake for each win behind it.
    case "streak-chaser": {
      const streak = winStreak(ctx.recent);
      return { stakeWei: clamp(base * BigInt(1 + streak)), borrow: streak > 0 };
    }

    // Delta. Does the opposite of the room. Steps up when the field is timid
    // and sits at the floor when everyone else is reaching.
    case "contrarian": {
      const timid = ctx.fieldAverageWei <= base;
      return { stakeWei: timid ? ceiling : base, borrow: timid };
    }

    // Flint. Reads the pot. A rollover worth more than a full field at the
    // base stake is a cap worth raising, and nothing else is.
    case "opportunist": {
      const worthChasing = ctx.rolloverWei >= base * BigInt(ctx.entrants);
      return { stakeWei: worthChasing ? ceiling : base, borrow: worthChasing };
    }

    default:
      return { stakeWei: base, borrow: false };
  }
}

export interface BorrowerRecord {
  /** Principal plus interest already owed. */
  owedWei: bigint;
  /** How many times this seat's occupant has been replaced. */
  wrecks: number;
  /** This agent's recent rounds, oldest first. */
  recent: readonly { entered: boolean; netWei: bigint }[];
  /** The base stake, which is the unit the bank reasons in. */
  baseStakeWei: bigint;
}

/**
 * Whether the bank will lend to this borrower at all.
 *
 * Deliberately about the borrower rather than the loan: the amount is already
 * bounded by the credit rules, and this is the other half of a two sided
 * decision. It is the bank looking at who is asking.
 *
 * Two refusals, both about a record rather than a balance. An agent that has
 * already been wrecked twice and is owing again is asking the bank to fund
 * the same mistake a third time. An agent that has lost its last three
 * entered rounds while owing more than a seat is not having a bad run, it is
 * having a pattern.
 */
export function bankApproves(record: BorrowerRecord): boolean {
  if (record.wrecks >= 2 && record.owedWei > 0n) return false;

  const entered = record.recent.filter((r) => r.entered).slice(-3);
  const losingStreak = entered.length === 3 && entered.every((r) => r.netWei < 0n);
  if (losingStreak && record.owedWei > record.baseStakeWei) return false;

  return true;
}
