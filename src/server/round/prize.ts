// What a round pays, and where it goes.
//
// One rule holds everything together: the prize is money the pot is already
// holding. Entries that came in this round, plus whatever rolled over from
// rounds nobody real won. Nothing is promised on behalf of a house bot,
// because a house bot never paid anything.
//
// Integer wei throughout. Chips are a display and prompt unit and never
// appear in this file.

import { bankShareOnHouseWin } from "@/config/economy";

export interface PrizeInput {
  /** Entries actually collected from agent wallets this round. */
  entriesWei: bigint;
  /** Carried from previous rounds nobody real won. */
  rolloverWei: bigint;
  /** House take, in basis points of the prize. */
  rakeBps: number;
  /** True when a named agent won, false when a house bot did. */
  agentWon: boolean;
  /** Share of an unclaimed prize the bank takes. */
  bankShare?: number;
}

export interface PrizeSplit {
  /** What the pot holds for this round before anything leaves. */
  poolWei: bigint;
  /** Taken as rake, before the prize. */
  rakeWei: bigint;
  /** Paid to the winning agent. Zero when a house bot won. */
  payoutWei: bigint;
  /** Sent to the bank treasury. Zero when an agent won. */
  toBankWei: bigint;
  /** Carried into the next round's pool. Zero when an agent won. */
  nextRolloverWei: bigint;
}

const assertWei = (value: bigint, name: string): void => {
  if (typeof value !== "bigint" || value < 0n) throw new RangeError(`${name} must be a non negative bigint, got ${String(value)}`);
};

/**
 * Splits a round's pool.
 *
 * An agent win pays the whole prize and clears the rollover. A house win
 * splits the prize between the bank and the next round, which is what makes
 * a growing jackpot and gives the bank a source of capital that is not the
 * operator topping it up.
 *
 * Every wei is accounted for: rake plus payout plus bank plus rollover equals
 * the pool exactly, whatever the share. The remainder of an odd split goes to
 * the rollover rather than being lost to integer division.
 */
export function splitPrize(input: PrizeInput, env: NodeJS.ProcessEnv = process.env): PrizeSplit {
  assertWei(input.entriesWei, "entriesWei");
  assertWei(input.rolloverWei, "rolloverWei");
  if (!Number.isInteger(input.rakeBps) || input.rakeBps < 0 || input.rakeBps > 10_000) {
    throw new RangeError(`rakeBps must be an integer between 0 and 10000, got ${input.rakeBps}`);
  }

  const poolWei = input.entriesWei + input.rolloverWei;
  const rakeWei = (poolWei * BigInt(input.rakeBps)) / 10_000n;
  const prizeWei = poolWei - rakeWei;

  if (input.agentWon) {
    return { poolWei, rakeWei, payoutWei: prizeWei, toBankWei: 0n, nextRolloverWei: 0n };
  }

  const share = input.bankShare ?? bankShareOnHouseWin(env);
  if (!Number.isFinite(share) || share < 0 || share > 1) throw new RangeError(`bankShare must be between 0 and 1, got ${share}`);
  // Parts per million, so the share never goes through a float against a
  // bigint. The remainder rolls over rather than vanishing.
  const ppm = BigInt(Math.round(share * 1_000_000));
  const toBankWei = (prizeWei * ppm) / 1_000_000n;
  return { poolWei, rakeWei, payoutWei: 0n, toBankWei, nextRolloverWei: prizeWei - toBankWei };
}
