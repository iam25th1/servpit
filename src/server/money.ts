// Integer money helpers for the server side. Everything on chain is wei
// as bigint; the engine speaks whole chips. Conversions fail closed.

import { weiPerChip } from "@/config/stake";

export type Wei = bigint;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * A chip in wei.
 *
 * The engine counts in chips: the stake tier, the pot, the rake and the
 * payouts are all whole chips. The chain counts in wei. This is the one
 * conversion between them, and it used to be one to one, which was fine only
 * while a chip and a wei happened to be the same size.
 *
 * They stopped being the same size when the stake became a share of a funded
 * wallet. The first round after that collected 60000000000000 wei of entries
 * and paid out 2400, because the transfer used the new figure and the engine
 * was still using the old one. Reconciliation caught it, which is what it is
 * for, and this is the fix.
 */
export function toWei(chips: number): bigint {
  if (typeof chips !== "number" || !Number.isSafeInteger(chips) || chips < 0) {
    throw new RangeError(`expected a non negative safe integer, got ${String(chips)}`);
  }
  return BigInt(chips) * weiPerChip();
}

/** Wei back to whole chips, rounded down. */
export function fromWei(wei: bigint): number {
  if (typeof wei !== "bigint" || wei < 0n) {
    throw new RangeError(`wei ${String(wei)} is outside the safe integer range`);
  }
  const chips = wei / weiPerChip();
  if (chips > MAX_SAFE) throw new RangeError(`wei ${String(wei)} is outside the safe integer range`);
  return Number(chips);
}

export function assertWei(value: unknown, name: string): asserts value is bigint {
  if (typeof value !== "bigint" || value < 0n) throw new RangeError(`${name} must be a non negative bigint`);
}

export function sumWei(values: Iterable<bigint>): bigint {
  let sum = 0n;
  for (const v of values) {
    assertWei(v, "wei");
    sum += v;
  }
  return sum;
}

/** Display only. Exact decimal string, never a float. */
export function formatEth(wei: bigint): string {
  assertWei(wei, "wei");
  const whole = wei / 1_000_000_000_000_000_000n;
  const frac = (wei % 1_000_000_000_000_000_000n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac.length ? `${whole}.${frac}` : `${whole}`;
}

const EXPLORERS: Record<string, string> = {
  "base-sepolia": "https://sepolia.basescan.org",
  "base-mainnet": "https://basescan.org",
};

function explorer(network: string): string {
  const base = EXPLORERS[network];
  if (!base) throw new RangeError(`no block explorer known for network ${network}`);
  return base;
}

export const basescanTx = (network: string, hash: string): string => `${explorer(network)}/tx/${hash}`;
export const basescanAddress = (network: string, address: string): string => `${explorer(network)}/address/${address}`;
