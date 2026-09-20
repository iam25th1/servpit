// URL parameters for the arena demo. Anything that is not a plain safe
// seed or an in range integer falls back to the defaults; the resolver
// validates again on its own.

import { battleRoyale } from "@/engine/modes/battleRoyale";

export const ARENA_DEFAULTS = { seed: "demo", entrants: 24 } as const;

const SEED = /^[A-Za-z0-9_-]{1,64}$/;
const INT = /^\d{1,4}$/;

type Raw = Record<string, string | string[] | undefined>;

export function parseArenaParams(params: Raw): { seed: string; entrants: number } {
  const seed = typeof params.seed === "string" && SEED.test(params.seed) ? params.seed : ARENA_DEFAULTS.seed;
  let entrants: number = ARENA_DEFAULTS.entrants;
  if (typeof params.entrants === "string" && INT.test(params.entrants)) {
    const n = Number.parseInt(params.entrants, 10);
    if (n >= battleRoyale.minEntrants && n <= battleRoyale.maxEntrants) entrants = n;
  }
  return { seed, entrants };
}
