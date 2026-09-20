// Integer helpers for every path a result depends on. Each function fails
// closed with a RangeError instead of silently producing a float or an
// unsafe integer.

const MAX = Number.MAX_SAFE_INTEGER;

export function assertInt(value: number, name: string, min: number = -MAX, max: number = MAX): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}], got ${String(value)}`);
  }
}

/** Exact floor division for non negative safe integers. */
export function idiv(dividend: number, divisor: number): number {
  assertInt(dividend, "dividend", 0);
  assertInt(divisor, "divisor", 1);
  return (dividend - (dividend % divisor)) / divisor;
}

/** base scaled by (100 + pct) percent, floored. pct may be negative down to -100. */
export function applyPct(base: number, pct: number): number {
  assertInt(base, "base", 0);
  assertInt(pct, "pct", -100);
  return idiv(base * (100 + pct), 100);
}
