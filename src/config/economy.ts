// The shape of the economy: what a prize is made of, and where it goes when
// nobody real wins.
//
// THE OLD PRIZE WAS INSOLVENT BY CONSTRUCTION. computePot charged every seat,
// all twenty four, and only the five or six real agents ever paid anything on
// chain. The other eighteen were house bots contributing nothing, so the pot
// wallet had to make up the difference out of its own balance every time an
// agent won.
//
// Measured on the live pot: it promised a 240 chip prize while agents paid in
// about 50 chips a round, against a 25 per cent chance an agent wins. That is
// 60 chips expected out against 50 in, so the pot drained about 10 chips a
// round and had enough for one more payout.
//
// The prize is now exactly what agents actually paid in, plus whatever rolled
// over from rounds nobody real won. The pot can always pay it, because the
// pot is holding it.

import type { EconomyConfig } from "@/economy/rules";

/**
 * Share of an unclaimed pot the bank takes when a house bot wins.
 *
 * Zero while no bank wallet exists. At zero every unclaimed prize rolls into
 * the next round, nothing is sent anywhere, and the pot can only ever pay out
 * what agents paid in. Raising it needs somewhere to send the share, so
 * assertBankShareIsPayable stops a run that has one set with no bank.
 */
export const DEFAULT_BANK_SHARE_ON_HOUSE_WIN = 0;

export function bankShareOnHouseWin(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SERVPIT_BANK_SHARE_ON_HOUSE_WIN?.trim();
  if (raw === undefined || raw.length === 0) return DEFAULT_BANK_SHARE_ON_HOUSE_WIN;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`SERVPIT_BANK_SHARE_ON_HOUSE_WIN must be between 0 and 1, got ${raw}`);
  }
  return value;
}

/**
 * Stops a run that would owe the bank a share with no bank wallet to pay it.
 *
 * Loudly, at startup, rather than quietly rolling the share over. A share
 * that silently becomes rollover is a number in a config file that does not
 * mean what it says, on a money surface.
 */
export function assertBankShareIsPayable(hasBankWallet: boolean, env: NodeJS.ProcessEnv = process.env): void {
  const share = bankShareOnHouseWin(env);
  if (share > 0 && !hasBankWallet) {
    throw new Error(
      `SERVPIT_BANK_SHARE_ON_HOUSE_WIN is ${share} but there is no bank wallet to send it to. ` +
        "Set it to 0 until a bank wallet exists, or add one.",
    );
  }
}

/**
 * Credit terms, expressed in stakes rather than absolute amounts.
 *
 * A stake is what a seat costs, so everything here reads as "how many rounds
 * of play". Absolute numbers would go stale the moment the stake moved, and
 * the stake is derived from what a wallet is funded with.
 *
 * These are starting points. npm run sim:economy measures what they do over
 * hundreds of rounds.
 */
export const CREDIT_TERMS = {
  /** Smallest loan worth writing: one seat. */
  minLoanStakes: 1n,
  /**
   * Most principal one agent may owe: three seats.
   *
   * At or under the ceiling, always. A bank that will lend an agent past the
   * ceiling is writing a loan that wrecks on arrival, and the simulator shows
   * exactly that shape when the two are set the other way round.
   */
  maxPrincipalStakes: 3n,
  /** A single loan may take a quarter of the treasury. */
  maxTreasuryShareBps: 2_500,
  /**
   * Simple interest per round on outstanding principal.
   *
   * A round is a minute of play, not a month, so this reads high and is not.
   * What it sets is how long an agent that stops repaying survives: at three
   * stakes of principal it adds six tenths of a stake a round, and the
   * ceiling is one stake above the principal cap, so it has about two rounds
   * to win its way back.
   *
   * Twenty per cent rather than the ten it was, because ten left the debt
   * ceiling firing on a third of wrecks and the rest on being broke. At
   * twenty it is four fifths, and the expected value of a debt free agent
   * improves from minus 0.072 chips a round to minus 0.018.
   */
  interestBps: 2_000,
  /**
   * Total debt above four seats wrecks the agent.
   *
   * One stake above the principal cap, deliberately. Set it far above and the
   * condition is dead config: the simulator measured zero ceiling wrecks in
   * two thousand rounds at eight stakes.
   */
  debtCeilingStakes: 4n,
  /**
   * Replacement agents are born clean.
   *
   * Born in debt is the only setting that moves the wreck rate into the two
   * to four per hundred band, and it only does so by making every
   * replacement doomed: at forty per cent on three stakes of birth debt
   * against a four stake ceiling, a replacement is over the ceiling after one
   * round and the bank seizes what it holds. That is a death sentence with a
   * loan agreement attached, not an economy.
   */
  replacementDebtStakes: 0n,
} as const;

export function economyConfig(stakeWei: bigint, overrides: Partial<EconomyConfig> = {}): EconomyConfig {
  if (typeof stakeWei !== "bigint" || stakeWei <= 0n) throw new RangeError(`stakeWei must be a positive bigint, got ${String(stakeWei)}`);
  return {
    minLoanWei: CREDIT_TERMS.minLoanStakes * stakeWei,
    maxPrincipalWei: CREDIT_TERMS.maxPrincipalStakes * stakeWei,
    maxTreasuryShareBps: CREDIT_TERMS.maxTreasuryShareBps,
    interestBps: CREDIT_TERMS.interestBps,
    debtCeilingWei: CREDIT_TERMS.debtCeilingStakes * stakeWei,
    stakeWei,
    replacementDebtWei: CREDIT_TERMS.replacementDebtStakes * stakeWei,
    ...overrides,
  };
}
