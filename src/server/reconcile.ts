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
  entries: Movement[];
  payouts: Movement[];
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

  const wallets = new Set<string>([...input.entries, ...input.payouts].map((m) => m.address));
  wallets.delete(input.potAddress);
  for (const address of [...wallets].sort()) {
    const delta = balance(input.after, address, "after") - balance(input.before, address, "before");
    const paidIn = sumWei(input.entries.filter((m) => m.address === address).map((m) => m.amountWei));
    const paidOut = sumWei(input.payouts.filter((m) => m.address === address).map((m) => m.amountWei));
    check(`wallet ${address} delta`, paidOut - paidIn, delta);
  }

  const entriesTotal = sumWei(input.entries.map((m) => m.amountWei));
  const payoutsTotal = sumWei(input.payouts.map((m) => m.amountWei));
  const potDelta = balance(input.after, input.potAddress, "after") - balance(input.before, input.potAddress, "before");
  check("pot delta", entriesTotal - payoutsTotal, potDelta);

  // Entries plus the house share minus rake is the prize. A winning agent
  // takes all of it; a house win retains all of it. Anything else is wrong.
  const prize = entriesTotal + input.houseContributionWei - input.rakeWei;
  const conservationOk = input.payouts.length === 0 ? prize >= 0n : payoutsTotal === prize;
  checks.push({ name: "conservation", ok: conservationOk, expected: prize.toString(), actual: input.payouts.length === 0 ? `retained ${prize.toString()}` : payoutsTotal.toString() });

  return { ok: checks.every((c) => c.ok), checks };
}
