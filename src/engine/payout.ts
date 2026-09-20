// Money math in integer minor units. BigInt for every product and division
// so nothing here can round.

import { assertInt } from "./intmath";

export interface Payout {
  entrantId: string;
  amount: number;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function computePot(stake: number, entrantCount: number): number {
  assertInt(stake, "stake", 1);
  assertInt(entrantCount, "entrantCount", 1);
  const pot = BigInt(stake) * BigInt(entrantCount);
  if (pot > MAX_SAFE) throw new RangeError("pot exceeds the safe integer range");
  return Number(pot);
}

/** floor(pot * rakeBps / 10000). rakeBps is basis points, 0 to 10000. */
export function computeRake(pot: number, rakeBps: number): number {
  assertInt(pot, "pot", 0);
  assertInt(rakeBps, "rakeBps", 0, 10_000);
  return Number((BigInt(pot) * BigInt(rakeBps)) / BigInt(10_000));
}

/** Throws unless payouts are non negative integers summing exactly to prize. */
export function assertConservation(payouts: readonly Payout[], prize: number): void {
  assertInt(prize, "prize", 0);
  let sum = BigInt(0);
  for (const p of payouts) {
    assertInt(p.amount, `payout for ${p.entrantId}`, 0);
    sum += BigInt(p.amount);
  }
  if (sum !== BigInt(prize)) {
    throw new Error(`payout conservation violated: paid ${sum} against prize ${prize}`);
  }
}
