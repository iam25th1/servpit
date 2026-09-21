// What a seat in a round costs, and the unit the game speaks in.
//
// THE STAKE. It was a flat 100 wei against a funded balance of 100 trillion
// wei, which is one part in a trillion. No agent was ever constrained by
// money, so an agent asked to weigh its balance against an allocation had
// nothing to weigh: every answer was yes, and the reasoning was decoration
// over a foregone conclusion. A stake has to be able to hurt.
//
// It is now a fraction of what a wallet is funded with, so the two move
// together. Change the funding target and the stake follows.
//
// CHIPS. Wei is not a number anyone can hold in their head, and a model
// handed 99868301341612 will repeat it back. The game speaks in chips: a
// whole number, small enough to reason about, shown to the player and given
// to the model. Wei stays the unit of record on the money surface and never
// leaves it.

import { parseEther } from "viem";

/** Default wallet funding, matching the funding script. */
export const DEFAULT_FUNDED_ETH = "0.0001";

/** Share of a funded wallet one seat costs. */
export const DEFAULT_STAKE_FRACTION = 0.1;

/** Chips a freshly funded wallet is worth. Everything else follows from this. */
export const CHIPS_PER_FUNDED_WALLET = 100;

function fundedWei(env: NodeJS.ProcessEnv): bigint {
  const raw = env.SERVPIT_FUND_TARGET_ETH?.trim();
  const text = raw === undefined || raw.length === 0 ? DEFAULT_FUNDED_ETH : raw;
  try {
    return parseEther(text as `${number}`);
  } catch {
    throw new RangeError(`SERVPIT_FUND_TARGET_ETH must be an amount in ETH, got ${text}`);
  }
}

function fraction(env: NodeJS.ProcessEnv): number {
  const raw = env.SERVPIT_STAKE_FRACTION?.trim();
  if (raw === undefined || raw.length === 0) return DEFAULT_STAKE_FRACTION;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new RangeError(`SERVPIT_STAKE_FRACTION must be greater than 0 and at most 1, got ${raw}`);
  }
  return value;
}

/**
 * One seat, in wei. A fraction of a funded wallet rather than a flat amount.
 *
 * Computed in whole parts per million so the fraction does not go through a
 * float multiplication against a bigint.
 */
export function stakeWeiFrom(env: NodeJS.ProcessEnv = process.env): bigint {
  const ppm = BigInt(Math.round(fraction(env) * 1_000_000));
  const wei = (fundedWei(env) * ppm) / 1_000_000n;
  if (wei <= 0n) throw new RangeError("the stake worked out to nothing, check SERVPIT_FUND_TARGET_ETH and SERVPIT_STAKE_FRACTION");
  return wei;
}

/** Wei one chip is worth. */
export function weiPerChip(env: NodeJS.ProcessEnv = process.env): bigint {
  return fundedWei(env) / BigInt(CHIPS_PER_FUNDED_WALLET);
}

/**
 * Wei as chips, rounded down.
 *
 * Down rather than nearest, because a balance shown as more than it is can
 * lead a player or a model to expect an entry that will not clear.
 */
export function toChips(wei: bigint, env: NodeJS.ProcessEnv = process.env): number {
  const per = weiPerChip(env);
  if (per <= 0n) return 0;
  return Number(wei / per);
}
