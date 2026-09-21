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
  /**
   * What it says as it sits down, in its own voice.
   *
   * Written rather than assembled: the wreck screen shows it directly after
   * the agent it replaced has been counted out, and a line stitched together
   * from a descriptor reads like a database row at the one moment that
   * should not.
   */
  readonly arrival: string;
}

export const REPLACEMENTS: readonly Replacement[] = Object.freeze([
  {
    id: "onyx",
    name: "Onyx",
    strategy: "cautious",
    descriptor: "watched the last one go and intends to leave with something",
    voice: "Quiet and wary. Speaks as if the room is listening.",
    face: "NinjaDark",
    arrival: "I watched that happen. I do not intend to be next.",
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
    arrival: "Somebody has to win that back. It may as well be me.",
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
    arrival: "The seat is free. I will take it, and I will count.",
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
    arrival: "The chair is still warm. That is usually a good sign.",
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
    arrival: "You all saw what that seat does. That is why I want it.",
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
    arrival: "I can wait. The pot will come to me.",
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
 * The replacement a seat gets when nothing says which one.
 *
 * Kept for records written before the occupant was stored: they carry a
 * generation and nothing else, and this is what they were read with.
 */
function byGeneration(identityId: string): Replacement {
  const generation = generationOf(identityId);
  return REPLACEMENTS[(generation - 2) % REPLACEMENTS.length] ?? REPLACEMENTS[0];
}

/** One of the pool, by its id. Undefined for a name that is not in it. */
export function replacementById(occupantId: string | null | undefined): Replacement | undefined {
  if (!occupantId) return undefined;
  return REPLACEMENTS.find((r) => r.id === occupantId);
}

/**
 * Who takes an emptied seat, given who is sitting in the others.
 *
 * Walking the pool by generation alone put the same person in two seats at
 * once: two seats on their second occupant were both Onyx, with one name and
 * one face between them, which is not a pit of six agents. The pool is walked
 * from a point that depends on the seat, and anyone already seated is passed
 * over, so two seats can never hold the same occupant at the same time.
 *
 * The pool is the same size as the roster, so there is always somebody free.
 * If there were not, the walk comes back to where it started and takes that
 * one rather than leaving the seat empty.
 */
export function chooseOccupant(walletId: string, taken: Iterable<string>): Replacement {
  const seated = new Set(taken);
  const seat = NAMED_AGENTS.findIndex((p) => p.id === walletId);
  const start = seat < 0 ? 0 : seat;
  for (let i = 0; i < REPLACEMENTS.length; i++) {
    const candidate = REPLACEMENTS[(start + i) % REPLACEMENTS.length];
    if (!seated.has(candidate.id)) return candidate;
  }
  return REPLACEMENTS[start % REPLACEMENTS.length];
}

/**
 * Who is in this seat now.
 *
 * Generation one is the agent that started there. After that it is whoever
 * was recorded when the seat was refilled, and for a record written before
 * occupants were recorded, whoever the generation points at.
 */
export function profileFor(walletId: string, identityId: string, occupantId?: string | null): AgentProfile {
  const generation = generationOf(identityId);
  if (generation <= 1) {
    const original = NAMED_AGENTS.find((p) => p.id === walletId);
    if (original) return original;
  }
  return replacementById(occupantId) ?? byGeneration(identityId);
}

/** The face the panel draws for whoever is in this seat. */
export function faceFor(walletId: string, identityId: string, occupantId?: string | null): string | null {
  if (generationOf(identityId) <= 1) return null;
  return (replacementById(occupantId) ?? byGeneration(identityId)).face;
}

/** What whoever is in this seat said when they took it. Null for an original. */
export function arrivalFor(walletId: string, identityId: string, occupantId?: string | null): string | null {
  if (generationOf(identityId) <= 1) return null;
  return (replacementById(occupantId) ?? byGeneration(identityId)).arrival;
}
