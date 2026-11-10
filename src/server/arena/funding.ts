// Whether the pit can pay for a round before it starts one.
//
// A round spends from three wallets. The pot pays the winner. The bank lends
// an agent that is short of a seat. The operator refills a seat whose agent
// was retired. The pot was the only one checked, on the reasoning that an
// empty bank is a lender saying no and an empty operator is a seat left
// empty, and both rounds still play.
//
// They do play, and that is the problem. On Base Sepolia the bank ran down to
// one chip and the operator to nothing, and every three minutes the round
// that followed refused every short agent, retired it for being refused, and
// sat a new agent in the same wallet with nothing to play with. That agent
// was short the next round too. Eighty nine thousand retirements later the
// graveyard was fifty four megabytes of the same five wallets.
//
// So the pit now asks all three before a round, and holds itself when any of
// them cannot cover its part. Nothing here moves money or writes a store:
// it reads balances and says what it found.

import { bankEnabled, maxLoanStakes, maxStakeMultiple } from "@/config/economy";
import { seatRefillWei, stakeWeiFrom, toChips, toChipsUp } from "@/config/stake";
import type { ServerContext } from "../context";
import type { ArenaFunds, ArenaHoldKind, ArenaWalletFunds } from "./state";

/** What the check reports, with the sentence a player is shown when it fails. */
export interface FundingReport extends ArenaFunds {
  /** Null when the round can be paid for. */
  reason: string | null;
  /** What kind of hold a failed check starts. Null when the round can be paid for. */
  holdKind: ArenaHoldKind | null;
}

/** The parts of a context the check reads. A test can hand it just these. */
export type FundingContext = Pick<ServerContext, "chain" | "wallets" | "bankroll"> & { flow: Pick<ServerContext["flow"], "rollover"> };

/**
 * Whether this pit lends at all.
 *
 * The same rule the plan uses: the bank on, a stake that can be raised, and a
 * bank wallet to lend from. Without lending nobody is refused credit, nobody
 * is retired for it, and neither the bank nor the operator is asked for
 * anything a round could spend.
 */
export function lends(ctx: Pick<FundingContext, "wallets">): boolean {
  return bankEnabled() && maxStakeMultiple() > 1 && Boolean(ctx.wallets.bank);
}

/**
 * The least the pot may hold: the prize it carries, plus the fee a payout
 * costs, and never less than one wei past that fee.
 */
export function potNeedsWei(carriedWei: bigint, reserveWei: bigint): bigint {
  const floor = reserveWei + 1n;
  const carrying = carriedWei + reserveWei;
  return carrying > floor ? carrying : floor;
}

/**
 * The least the bank may hold: the largest loan it is allowed to make, and the
 * fee for sending it. Below this it cannot carry even one short agent back
 * into a seat, and every short agent it refuses is retired.
 */
export function bankNeedsWei(stakeWei: bigint, reserveWei: bigint): bigint {
  return maxLoanStakes() * stakeWei + reserveWei;
}

/**
 * The least the operator may hold: one whole refill and the fee for sending
 * it. A retirement is only allowed when the seat it empties can be refilled
 * in full, so an operator under this would hold every retirement.
 */
export function operatorNeedsWei(stakeWei: bigint, reserveWei: bigint): bigint {
  return seatRefillWei(stakeWei) + reserveWei;
}

function walletFunds(heldWei: bigint, neededWei: bigint): ArenaWalletFunds {
  const shortWei = neededWei > heldWei ? neededWei - heldWei : 0n;
  return {
    chips: toChips(heldWei),
    wei: heldWei.toString(),
    neededChips: toChipsUp(neededWei),
    neededWei: neededWei.toString(),
    shortChips: toChipsUp(shortWei),
    shortWei: shortWei.toString(),
    ok: shortWei === 0n,
  };
}

/** The wallets that came up short, named the way a player would say them. */
function shortList(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The sentence on the paused screen. */
export function outOfFundsReason(short: string[]): string {
  const who = shortList(short);
  const verb = short.length > 1 ? "are" : "is";
  const them = short.length > 1 ? "they are" : "it is";
  return `The pit is paused because ${who} ${verb} out of funds. It starts again on its own once ${them} topped up.`;
}

/**
 * Reads the three wallets and says whether a round can be paid for.
 *
 * One balance read each, through the same cache the round uses, so a round
 * that starts straight after a passing check reads the same figures it was
 * passed on.
 */
export async function fundingCheck(ctx: FundingContext, now: number = Date.now()): Promise<FundingReport> {
  const reserveWei = ctx.chain.gasReserveWei;
  const stakeWei = stakeWeiFrom();
  const potWei = await ctx.bankroll.get(ctx.wallets.pot);
  const pot = walletFunds(potWei, potNeedsWei(ctx.flow.rollover.carriedWei, reserveWei));

  const lending = lends(ctx);
  const bank = lending && ctx.wallets.bank ? walletFunds(await ctx.bankroll.get(ctx.wallets.bank), bankNeedsWei(stakeWei, reserveWei)) : null;
  const operator = lending && ctx.wallets.operator ? walletFunds(await ctx.bankroll.get(ctx.wallets.operator), operatorNeedsWei(stakeWei, reserveWei)) : null;

  const short = [...(bank && !bank.ok ? ["the bank"] : []), ...(operator && !operator.ok ? ["the operator"] : []), ...(!pot.ok ? ["the pot"] : [])];
  const ok = short.length === 0;
  return {
    checkedAt: new Date(now).toISOString(),
    ok,
    pot,
    bank,
    operator,
    reason: ok ? null : outOfFundsReason(short),
    holdKind: ok ? null : "funds",
  };
}
