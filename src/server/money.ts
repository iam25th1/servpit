// Integer money helpers for the server side. Everything on chain is wei
// as bigint; the engine speaks safe integers. Conversions fail closed.

export type Wei = bigint;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function toWei(minorUnits: number): bigint {
  if (typeof minorUnits !== "number" || !Number.isSafeInteger(minorUnits) || minorUnits < 0) {
    throw new RangeError(`expected a non negative safe integer, got ${String(minorUnits)}`);
  }
  return BigInt(minorUnits);
}

export function fromWei(wei: bigint): number {
  if (typeof wei !== "bigint" || wei < 0n || wei > MAX_SAFE) {
    throw new RangeError(`wei ${String(wei)} is outside the safe integer range`);
  }
  return Number(wei);
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
