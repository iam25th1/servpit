// Who takes a seat after the agent in it is finished.
//
// A wrecked agent's wallet is reused, so no new key is ever generated at
// runtime. What changes is the occupant: a new name, a new posture, a new
// voice and a face none of the originals wear, so the panel shows somebody
// new rather than the same six names cycling.
//
// Faces are drawn from the part of the roster the originals do not use. The
// six who started wear Boy, Hunter, Knight, NinjaRed and NinjaBlue, so these
// take the rest.
//
// Data only. No secrets, no keys, safe for the client bundle.

import { NAMED_AGENTS, type AgentProfile } from "./agents";

/** A profile plus the face the panel draws for it. */
export interface Replacement extends AgentProfile {
  readonly face: string;
}

export const REPLACEMENTS: readonly Replacement[] = Object.freeze([
  {
    id: "onyx",
    name: "Onyx",
    strategy: "cautious",
    descriptor: "watched the last one go and intends to leave with something",
    voice: "Quiet and wary. Speaks as if the room is listening.",
    face: "NinjaDark",
    minBankrollMultiple: 5,
    baseEnterChance: 40,
    afterWinShift: 5,
    afterLossShift: -20,
  },
  {
    id: "vex",
    name: "Vex",
    strategy: "aggressive",
    descriptor: "arrived to make back somebody else's losses and knows how that sounds",
    voice: "Fast and needling. Enjoys being the one who pushed.",
    face: "NinjaFire",
    minBankrollMultiple: 1,
    baseEnterChance: 85,
    afterWinShift: 5,
    afterLossShift: 5,
  },
  {
    id: "tally",
    name: "Tally",
    strategy: "steady",
    descriptor: "counts every round the same way and does not hurry",
    voice: "Flat and precise. States the number and stops.",
    face: "KnightGold",
    minBankrollMultiple: 3,
    baseEnterChance: 65,
    afterWinShift: 0,
    afterLossShift: 0,
  },
  {
    id: "wick",
    name: "Wick",
    strategy: "streak-chaser",
    descriptor: "believes a run is a run and rides it while it lasts",
    voice: "Warm and superstitious. Talks about how it is going.",
    face: "NinjaWater",
    minBankrollMultiple: 2,
    baseEnterChance: 60,
    afterWinShift: 30,
    afterLossShift: -25,
  },
  {
    id: "brand",
    name: "Brand",
    strategy: "contrarian",
    descriptor: "takes the other side of whatever the room has decided",
    voice: "Dry and contrary. Sounds amused by everyone else.",
    face: "GladiatorBlue",
    minBankrollMultiple: 2,
    baseEnterChance: 55,
    afterWinShift: -25,
    afterLossShift: 25,
  },
  {
    id: "rime",
    name: "Rime",
    strategy: "opportunist",
    descriptor: "waits for a pot worth the trouble and ignores the rest",
    voice: "Patient and clipped. Only speaks when the pot is big.",
    face: "Eskimo",
    minBankrollMultiple: 2,
    baseEnterChance: 50,
    afterWinShift: 10,
    afterLossShift: -10,
  },
] as const);

/** The faces the six originals wear, which no replacement may reuse. */
export const ORIGINAL_FACES: readonly string[] = Object.freeze(["Boy", "Hunter", "Knight", "NinjaRed", "NinjaBlue"]);

const GENERATION = /-(\d+)$/;

/** Which generation an identity is. One is whoever started in the seat. */
export function generationOf(identityId: string): number {
  const match = GENERATION.exec(identityId);
  const n = match ? Number(match[1]) : 1;
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

/**
 * Who is in this seat now.
 *
 * Generation one is the agent that started there. After that the pool is
 * walked in order and then reused, so a long run of wrecks keeps producing
 * somebody rather than running out of people.
 *
 * Derived from the identity rather than stored, so there is one source of
 * truth for who is in a seat and it is the same thing a debt is stamped with.
 */
export function profileFor(walletId: string, identityId: string): AgentProfile {
  const generation = generationOf(identityId);
  if (generation <= 1) {
    const original = NAMED_AGENTS.find((p) => p.id === walletId);
    if (original) return original;
  }
  return REPLACEMENTS[(generation - 2) % REPLACEMENTS.length] ?? REPLACEMENTS[0];
}

/** The face the panel draws for whoever is in this seat. */
export function faceFor(walletId: string, identityId: string): string | null {
  const generation = generationOf(identityId);
  if (generation <= 1) return null;
  return (REPLACEMENTS[(generation - 2) % REPLACEMENTS.length] ?? REPLACEMENTS[0]).face;
}
