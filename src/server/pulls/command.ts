// The operator's commands for the lever, parsed and reported.
//
// Here rather than in the script so both halves can be tested without a
// terminal: what an argument list means, and what a status reads like. The
// script reads the environment, writes the file and prints.
//
// These numbers are what stands between a public button and the operator's
// account, so they are set from a machine and nowhere else. Nothing over HTTP
// reaches this file.

import { HOUR_MS } from "@/config/pulls";
import { MICRO_CENTS_PER_CENT, type BudgetState } from "./budget";
import type { PullSettings } from "./settings";

export type PullCommand =
  | { kind: "status" }
  | { kind: "set"; settings: Partial<PullSettings> };

/** What a whole number argument has to be to be worth writing down. */
function whole(raw: string | undefined, name: string, min: number, max: number): number {
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} takes a whole number between ${min} and ${max}, got ${raw ?? "nothing"}`);
  }
  return value;
}

/**
 * What the arguments ask for.
 *
 * No command is status, because a operator typing the bare command wants to
 * know where things stand rather than to change them.
 */
export function parsePullCommand(argv: readonly string[]): PullCommand {
  const raw = argv[0]?.trim().toLowerCase();
  const value = argv[1]?.trim().toLowerCase();
  if (raw === undefined || raw === "status") return { kind: "status" };
  if (raw === "per-identity") {
    if (value === "unlimited" || value === "none" || value === "off") return { kind: "set", settings: { perIdentity: null } };
    return { kind: "set", settings: { perIdentity: whole(value, "per-identity", 1, 1_000) } };
  }
  if (raw === "window") return { kind: "set", settings: { windowHours: whole(value, "window", 1, 24 * 7) } };
  if (raw === "budget") return { kind: "set", settings: { dailyBudgetCents: whole(value, "budget", 0, 100_000) } };
  if (raw === "per-hour") return { kind: "set", settings: { perHour: whole(value, "per-hour", 1, 1_000) } };
  throw new RangeError(`unknown command ${raw}. Use status, per-identity, window, budget or per-hour.`);
}

export interface PullStatusInput {
  settings: PullSettings;
  budget: BudgetState;
  /** Rounds the lever has started in the last hour. */
  startedThisHour: number;
  /** True while the operator switch allows reasoning at all. */
  reasoningOn: boolean;
  /** Whether scheduled rounds reason too. */
  scheduledReasoning: boolean;
  /** The handle waiting for the worker, or null. */
  pendingHandle: string | null;
}

const cents = (microCents: number): string => `${(microCents / MICRO_CENTS_PER_CENT).toFixed(2)} cents`;

/** The status, as lines, so the script prints and this can be read back. */
export function pullStatusLines(input: PullStatusInput): string[] {
  const { settings, budget } = input;
  return [
    `per browser: ${settings.perIdentity === null ? "unlimited" : `${settings.perIdentity} pulls every ${settings.windowHours} hours`}`,
    `across everybody: ${settings.perHour} rounds an hour, ${input.startedThisHour} started in the last hour`,
    `reasoning budget: ${cents(budget.spentMicroCents)} of ${cents(budget.budgetMicroCents)} spent today, ${budget.withinBudget ? "so a pulled round reasons" : "so rounds run on instinct until it rolls off"}`,
    `operator switch: reasoning is ${input.reasoningOn ? "on" : "off"}, scheduled rounds ${input.scheduledReasoning ? "reason" : "run on instinct"}`,
    `waiting: ${input.pendingHandle === null ? "nobody" : `${input.pendingHandle} is waiting for the next round`}`,
  ];
}

/** The window, in milliseconds, which is what the limit is counted over. */
export function windowMs(settings: PullSettings): number {
  return settings.windowHours * HOUR_MS;
}
