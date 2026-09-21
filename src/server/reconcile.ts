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
  /** Stake the operator pot covers for house bots, already held in the pot. */
  houseContributionWei: bigint;
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
  assertWei(input.houseContributionWei, "houseContributionWei");
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

  // Entries plus the house share minus rake is the prize. A winning agent
  // takes all of it; a house win retains all of it. Anything else is wrong.
  const prize = entriesTotal + input.houseContributionWei - input.rakeWei;
  const conservationOk = input.payouts.length === 0 ? prize >= 0n : payoutsTotal === prize;
  checks.push({ name: "conservation", ok: conservationOk, expected: prize.toString(), actual: input.payouts.length === 0 ? `retained ${prize.toString()}` : payoutsTotal.toString() });

  return { ok: checks.every((c) => c.ok), checks };
}
