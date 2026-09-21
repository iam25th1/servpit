// Reconciliation against on chain balances. Inputs are balances read from
// the chain before and after the round plus the transfers the ledger says
// it made. Nothing here trusts a local number about money: every check
// compares a chain delta to what the transfers imply.

import { assertWei, sumWei } from "./money";

export interface Movement {
  address: string;
  amountWei: bigint;
}

export interface ReconcileInput {
  potAddress: string;
  before: Record<string, bigint>;
  after: Record<string, bigint>;
  /** The round's full movement set. Used for the conservation check. */
  entries: Movement[];
  payouts: Movement[];
  /**
   * What actually moved during this execution window. Defaults to the full
   * set. A replay of an already settled round applies nothing, so its wallet
   * deltas are zero while the round's conservation still holds.
   */
  appliedEntries?: Movement[];
  appliedPayouts?: Movement[];
  /**
   * Transaction fees paid out of each wallet during this execution window,
   * taken from the receipts.
   *
   * Until the phase 5 viem swap the agents were CDP smart wallets and the
   * paymaster paid their gas, so a wallet's raw balance delta was exactly
   * its stake movement and this did not exist. Plain accounts pay their own
   * fees, so the delta now carries a cost the stake accounting knows nothing
   * about: the first settled round on Base Sepolia showed -132252136528 wei
   * against an expected -100, and the difference was the fee to the wei.
   *
   * It is a receipt figure and never an estimate, and never the gap between
   * expected and observed. Deriving it from the gap would make every wallet
   * check pass by construction, which on a money surface is worse than the
   * wrong answer it replaced.
   *
   * Only fees from transfers applied in this window belong here. A replay
   * that applies nothing pays nothing.
   */
  feesWei?: Movement[];
  /**
   * Rollover this round inherited from rounds nobody real won.
   *
   * This replaced a house contribution: the pot used to promise a stake on
   * behalf of all eighteen house bots, none of which ever paid anything, and
   * covered the difference out of its own balance. A seat that did not pay
   * now adds nothing. Rollover is different in kind because the pot is
   * already holding it.
   */
  rolloverInWei: bigint;
  /** Left in the pot for the next round. Zero when an agent won. */
  nextRolloverWei: bigint;
  /** Sent to the bank treasury. Zero while there is no bank wallet. */
  toBankWei: bigint;
  rakeWei: bigint;
}

export interface Check {
  name: string;
  ok: boolean;
  expected: string;
  actual: string;
}

export interface ReconcileResult {
  ok: boolean;
  checks: Check[];
}

function balance(table: Record<string, bigint>, address: string, label: string): bigint {
  if (!Object.prototype.hasOwnProperty.call(table, address)) throw new Error(`${label} balance for ${address} missing`);
  const v = table[address];
  assertWei(v, `${label} balance for ${address}`);
  return v;
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  assertWei(input.rolloverInWei, "rolloverInWei");
  assertWei(input.nextRolloverWei, "nextRolloverWei");
  assertWei(input.toBankWei, "toBankWei");
  assertWei(input.rakeWei, "rakeWei");
  const checks: Check[] = [];
  const check = (name: string, expected: bigint, actual: bigint): void => {
    checks.push({ name, ok: expected === actual, expected: expected.toString(), actual: actual.toString() });
  };

  const appliedEntries = input.appliedEntries ?? input.entries;
  const appliedPayouts = input.appliedPayouts ?? input.payouts;
  const fees = input.feesWei ?? [];
  for (const f of fees) assertWei(f.amountWei, `fee for ${f.address}`);
  const wallets = new Set<string>([...input.entries, ...input.payouts].map((m) => m.address));
  wallets.delete(input.potAddress);
  for (const address of [...wallets].sort()) {
    const delta = balance(input.after, address, "after") - balance(input.before, address, "before");
    const paidIn = sumWei(appliedEntries.filter((m) => m.address === address).map((m) => m.amountWei));
    const paidOut = sumWei(appliedPayouts.filter((m) => m.address === address).map((m) => m.amountWei));
    // The fee leaves the wallet alongside the stake, so the stake movement is
    // the delta with the fee added back. Expressed on the expected side so a
    // failure still reports the stake figures the operator reasons about.
    const feePaid = sumWei(fees.filter((m) => m.address === address).map((m) => m.amountWei));
    check(`wallet ${address} delta`, paidOut - paidIn, delta + feePaid);
  }

  const entriesTotal = sumWei(input.entries.map((m) => m.amountWei));
  const payoutsTotal = sumWei(input.payouts.map((m) => m.amountWei));
  const potDelta = balance(input.after, input.potAddress, "after") - balance(input.before, input.potAddress, "before");
  // The pot pays gas too, on any round it actually pays a winner. It never
  // had to before, because a house bot won every settled round and the pot
  // only ever received. The first round an agent won came up short by exactly
  // the payout's fee.
  const potFee = sumWei(fees.filter((m) => m.address === input.potAddress).map((m) => m.amountWei));
  check("pot delta", sumWei(appliedEntries.map((m) => m.amountWei)) - sumWei(appliedPayouts.map((m) => m.amountWei)), potDelta + potFee);

  // Every wei the round took in is accounted for on the way out. Entries plus
  // the rollover it inherited equal the payout plus the bank share plus the
  // rollover it leaves plus the rake, exactly. This used to be an inequality
  // on a house win, which could not see a prize going astray.
  const inWei = entriesTotal + input.rolloverInWei;
  const outWei = payoutsTotal + input.toBankWei + input.nextRolloverWei + input.rakeWei;
  check("conservation", inWei, outWei);

  // The pot can only ever send what it is already holding. The entries landed
  // in it before the payout left, so they count. Applied movements only: a
  // replay sends nothing, so it needs to cover nothing.
  //
  // This is the check the old insolvent prize would have failed. It promised
  // 240 chips against about 50 paid in and the pot made up the difference out
  // of its own balance until the balance ran out.
  const sentWei = sumWei(appliedPayouts.map((m) => m.amountWei));
  const coverWei = balance(input.before, input.potAddress, "before") + sumWei(appliedEntries.map((m) => m.amountWei));
  checks.push({ name: "pot covers payout", ok: sentWei <= coverWei, expected: `at most ${coverWei.toString()}`, actual: sentWei.toString() });

  return { ok: checks.every((c) => c.ok), checks };
}
