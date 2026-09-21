// What a round pays when agents may stake different amounts.
//
// Pure, and deliberately not the live settle path's splitPrize. The running
// game still pays one fixed stake per seat and its prize model is unchanged;
// this is the model the simulator runs so the design can be measured before
// any of it is wired to money.
//
// The rule that makes a variable stake mean something: a winner takes at most
// the share of the prize its stake earned against the biggest stake in the
// field. Without a cap, an agent staking the floor could sweep a pot that
// bigger stakers and a long rollover built, and staking more would buy
// nothing but a larger loss.
//
// The cap is relative rather than absolute, and that was measured rather than
// assumed. An absolute cap of the field size times the winner's own stake
// strands money: a field of base stakers pays in every round and can never
// take out more than twenty four stakes, so the pot only grows. Over 2000
// rounds it left between 4000 and 25000 chips behind a wall nobody could
// reach, agents bled into it, and the operator refilled them at up to 3000
// chips per 100 rounds. A relative cap drains the pot whenever the field
// stakes evenly, and only bites on the agent that under-staked the room.

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
  /** The largest stake anyone put up this round. Never below the winner's. */
  highestStakeWei: bigint;
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
 * The cap is the winner's share of the biggest stake anyone put up. Matching
 * the largest staker takes the whole prize; staking a third of what the room
 * put up takes a third and leaves the rest for the next round, which is what
 * stops a minimum stake from being the best play available.
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
  assertMinor(input.highestStakeWei, "highestStakeWei");

  const rakeWei = (input.poolWei * BigInt(input.rakeBps)) / 10_000n;
  const prizeWei = input.poolWei - rakeWei;

  if (input.winnerStakeWei === null) {
    return { poolWei: input.poolWei, rakeWei, payoutWei: 0n, nextRolloverWei: prizeWei, capWei: 0n, capped: false };
  }

  assertMinor(input.winnerStakeWei, "winnerStakeWei");
  if (input.winnerStakeWei > input.highestStakeWei) {
    throw new RangeError(`highestStakeWei ${input.highestStakeWei} is below the winner's own stake ${input.winnerStakeWei}`);
  }

  // The winner's share of the biggest stake in the room. Matching the largest
  // staker takes the whole prize; staking a third of what the room put up
  // takes a third and leaves the rest for the next round.
  const capWei = input.highestStakeWei === 0n ? prizeWei : (prizeWei * input.winnerStakeWei) / input.highestStakeWei;
  const payoutWei = prizeWei < capWei ? prizeWei : capWei;
  return { poolWei: input.poolWei, rakeWei, payoutWei, nextRolloverWei: prizeWei - payoutWei, capWei, capped: payoutWei < prizeWei };
}
