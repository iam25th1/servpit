// The operator's commands for the seats, parsed and reported.
//
// Here rather than in the script so both halves can be tested without a
// terminal: what an argument list means, and what a status reads like.
//
// These numbers decide how much of the pit belongs to visitors, so they are
// set from a machine and nowhere else. Nothing over HTTP reaches this file.

import type { FighterSettings } from "./settings";

export type FighterCommand = { kind: "status" } | { kind: "set"; settings: Partial<FighterSettings> };

function whole(raw: string | undefined, name: string, min: number, max: number): number {
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} takes a whole number between ${min} and ${max}, got ${raw ?? "nothing"}`);
  }
  return value;
}

/** What the arguments ask for. No command is status. */
export function parseFighterCommand(argv: readonly string[]): FighterCommand {
  const raw = argv[0]?.trim().toLowerCase();
  const value = argv[1]?.trim().toLowerCase();
  if (raw === undefined || raw === "status") return { kind: "status" };
  if (raw === "cap") return { kind: "set", settings: { cap: whole(value, "cap", 1, 100) } };
  if (raw === "reserve") return { kind: "set", settings: { reserve: whole(value, "reserve", 0, 100) } };
  if (raw === "release-hours") return { kind: "set", settings: { releaseHours: whole(value, "release-hours", 1, 24 * 365) } };
  throw new RangeError(`unknown command ${raw}. Use status, cap, reserve or release-hours.`);
}

export interface FighterStatusInput {
  settings: FighterSettings;
  /** Seats claimed right now. */
  claimed: number;
  /** Faces nobody is using. */
  freeFaces: number;
  /** Claims released by the sweep this command just ran. */
  released: readonly string[];
  /** The claims themselves, newest visit first. */
  fighters: ReadonlyArray<{ handle: string; name: string; face: string; hoursSinceSeen: number }>;
}

/** The status, as lines, so the script prints and this can be read back. */
export function fighterStatusLines(input: FighterStatusInput): string[] {
  const { settings } = input;
  const lines = [
    `seats: ${input.claimed} claimed of ${settings.cap}, ${input.freeFaces} faces free, ${settings.reserve} kept for somebody new`,
    `released after ${settings.releaseHours} hours without a visit`,
  ];
  if (input.released.length > 0) lines.push(`released just now: ${input.released.join(", ")}`);
  for (const fighter of input.fighters) {
    lines.push(`  ${fighter.name} (${fighter.handle}, ${fighter.face}), last here ${fighter.hoursSinceSeen} hours ago`);
  }
  if (input.fighters.length === 0) lines.push("  nobody has claimed a seat");
  return lines;
}
