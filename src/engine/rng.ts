// Seeded PRNG for the resolver. sfc32 state, seeded from a string via a
// cyrb128 style hash. Every operation here is 32 bit integer arithmetic
// (Math.imul, shifts, xor, >>> 0). No floats, no clock, no unseeded source.

export interface Rng {
  /** Next draw as an unsigned 32 bit integer in [0, 2^32). */
  nextU32(): number;
  /** Unbiased integer in [0, maxExclusive). maxExclusive must be an integer in [1, 2^32]. */
  nextInt(maxExclusive: number): number;
}

const TWO_POW_32 = 0x1_0000_0000;

function hashSeed(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function createRng(seed: string): Rng {
  if (typeof seed !== "string") {
    throw new TypeError("seed must be a string");
  }
  let [a, b, c, d] = hashSeed(seed);

  const nextU32 = (): number => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };

  // Discard the first outputs so short or similar seeds decorrelate.
  for (let i = 0; i < 12; i++) nextU32();

  const nextInt = (maxExclusive: number): number => {
    if (
      !Number.isInteger(maxExclusive) ||
      maxExclusive < 1 ||
      maxExclusive > TWO_POW_32
    ) {
      throw new RangeError("maxExclusive must be an integer in [1, 2^32]");
    }
    if (maxExclusive === 1) return 0;
    // Rejection sampling: accept r >= (2^32 mod n) so r mod n is unbiased.
    const threshold = TWO_POW_32 % maxExclusive;
    let r = nextU32();
    while (r < threshold) r = nextU32();
    return r % maxExclusive;
  };

  return { nextU32, nextInt };
}
