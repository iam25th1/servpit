// Request validation for the round routes. Anything unexpected is a 400;
// nothing here is trusted downstream.

import { battleRoyale } from "@/engine/modes/battleRoyale";

const SEED = /^[A-Za-z0-9_-]{1,64}$/;

export type ParsedRoundRequest = { ok: true; seed: string; entrants: number } | { ok: false; error: string };

export function parseRoundRequest(body: unknown): ParsedRoundRequest {
  if (typeof body !== "object" || body === null) return { ok: false, error: "body must be an object" };
  const { seed, entrants } = body as { seed?: unknown; entrants?: unknown };
  if (typeof seed !== "string" || !SEED.test(seed)) return { ok: false, error: `seed must match ${SEED}` };
  if (!Number.isSafeInteger(entrants) || (entrants as number) < battleRoyale.minEntrants || (entrants as number) > battleRoyale.maxEntrants) {
    return { ok: false, error: `entrants must be an integer between ${battleRoyale.minEntrants} and ${battleRoyale.maxEntrants}` };
  }
  return { ok: true, seed, entrants: entrants as number };
}
