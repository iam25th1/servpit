// What a round pays when agents may stake different amounts.
//
// Pure, and deliberately not the live settle path's splitPrize. The running
// game still pays one fixed stake per seat and its prize model is unchanged;
// this is the model the simulator runs so the design can be measured before
// any of it is wired to money.
//
// The rule that makes a variable stake mean something: a winner takes at most
// what its own stake bought. Without a cap, an agent staking the floor could
// sweep a pot that bigger stakers and a long rollover built, and staking more
// would buy nothing but a larger loss.

const assertMinor = (value: bigint, name: string): void => {
  if (typeof value !== "bigint" || value < 0n) throw new RangeError(`${name} must be a non negative bigint, got ${String(value)}`);
};

/**
 * How far above the base stake an agent may go.
 *
 * A floor at the base stake, because a seat has a price. A ceiling, because
 * an unbounded stake makes one round decide everything and turns the credit
 * rules into a formality.
 */
export function clampStake(baseStakeWei: bigint, maxMultiple: number, wantWei: bigint): bigint {
  assertMinor(baseStakeWei, "baseStakeWei");
  assertMinor(wantWei, "wantWei");
  if (baseStakeWei === 0n) throw new RangeError("baseStakeWei must be greater than zero");
  if (!Number.isInteger(maxMultiple) || maxMultiple < 1) throw new RangeError(`maxMultiple must be a whole number of stakes, at least 1, got ${maxMultiple}`);
  const ceiling = baseStakeWei * BigInt(maxMultiple);
  if (wantWei < baseStakeWei) return baseStakeWei;
  return wantWei > ceiling ? ceiling : wantWei;
}

export interface CappedPrizeInput {
  /** Entries collected this round plus whatever rolled over. */
  poolWei: bigint;
  /** House take, in basis points of the pool. */
  rakeBps: number;
  /** The winner's own stake, or null when a house bot won. */
  winnerStakeWei: bigint | null;
  /** Seats in the field, which sets how far one stake can reach. */
  entrants: number;
}

export interface CappedPrize {
  poolWei: bigint;
  rakeWei: bigint;
  payoutWei: bigint;
  /** What the cap held back, plus the whole prize on a house win. */
  nextRolloverWei: bigint;
  /** The most this winner's stake could have taken. */
  capWei: bigint;
  /** True when the cap, rather than the pool, decided the payout. */
  capped: boolean;
}

/**
 * Splits a pool when the winner's stake decides how much of it it can take.
 *
 * The cap is the field size times the winner's own stake: what that stake
 * would have won if every seat had matched it. A winner that staked the floor
 * into a pot swollen by rollover takes its share and leaves the rest for the
 * next round, which is what stops a minimum stake from being the best play.
 *
 * Solvency is structural rather than checked: the payout is a minimum of the
 * prize and the cap, so it can never exceed the pool, and whatever is not
 * paid is rolled over rather than lost. Rake plus payout plus rollover equals
 * the pool exactly, which is the 12a invariant carried forward.
 */
export function splitCappedPrize(input: CappedPrizeInput): CappedPrize {
  assertMinor(input.poolWei, "poolWei");
  if (!Number.isInteger(input.rakeBps) || input.rakeBps < 0 || input.rakeBps > 10_000) {
    throw new RangeError(`rakeBps must be an integer between 0 and 10000, got ${input.rakeBps}`);
  }
  if (!Number.isInteger(input.entrants) || input.entrants < 1) throw new RangeError(`entrants must be a positive integer, got ${input.entrants}`);

  const rakeWei = (input.poolWei * BigInt(input.rakeBps)) / 10_000n;
  const prizeWei = input.poolWei - rakeWei;

  if (input.winnerStakeWei === null) {
    return { poolWei: input.poolWei, rakeWei, payoutWei: 0n, nextRolloverWei: prizeWei, capWei: 0n, capped: false };
  }

  assertMinor(input.winnerStakeWei, "winnerStakeWei");
  const capWei = input.winnerStakeWei * BigInt(input.entrants);
  const payoutWei = prizeWei < capWei ? prizeWei : capWei;
  return { poolWei: input.poolWei, rakeWei, payoutWei, nextRolloverWei: prizeWei - payoutWei, capWei, capped: payoutWei < prizeWei };
}
