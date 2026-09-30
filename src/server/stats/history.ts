// How far back each figure reaches, and which rounds can still be spoken for.
//
// The round store keeps the last two hundred rounds, which at the live
// interval is about ten hours. Reporting off it alone said zero reasoned
// rounds when the reasoned rounds were simply older than the window. Three
// other stores keep everything: the ledger, the wreck store, and the append
// only logs. So the lifetime figures come from those, and a figure taken from
// the window says so rather than passing itself off as a lifetime one.
//
// What cannot be recovered is said rather than inferred. A decision's source
// lives in the round record and in a quoted plan, and nowhere else: no
// transfer, wreck, pick or pull carries it. A round whose record has aged out
// is unclassified, and counting it as instinct because nothing says otherwise
// would be inventing the answer this whole exercise exists to avoid.

import type { PlanRow, RoundRow, Stores } from "./read";

/** The oldest and newest moment a set of rows covers, in milliseconds. */
export interface Span {
  oldest: number | null;
  newest: number | null;
}

export function spanOf(times: readonly (number | null)[]): Span {
  const real = times.filter((t): t is number => t !== null && Number.isFinite(t));
  return real.length === 0 ? { oldest: null, newest: null } : { oldest: Math.min(...real), newest: Math.max(...real) };
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** How long a span is, in the largest unit that reads plainly. */
export function lengthOf(span: Span): string {
  if (span.oldest === null || span.newest === null) return "no dates on file";
  const hours = (span.newest - span.oldest) / 3_600_000;
  if (hours < 48) return `${hours.toFixed(1)} hours`;
  return `${(hours / 24).toFixed(1)} days`;
}

/**
 * Where a figure came from and what it covers, as one short phrase.
 *
 * Printed beside every number, because the whole bug this file exists for was
 * a windowed number read as a lifetime one.
 */
export function covers(from: string, span: Span): string {
  if (span.oldest === null || span.newest === null) return from;
  return `${from}, ${day(span.oldest)} to ${day(span.newest)}, ${lengthOf(span)}`;
}

export type RoundClass = "reasoned" | "learned" | "instinct";

export interface LifetimeRounds {
  /** Every round id any surviving store mentions. */
  ids: Set<string>;
  /** When each of those rounds happened, where a store can date it. */
  dated: Map<string, number>;
  /** How many ids each store contributed. */
  bySource: Record<string, number>;
  /** The rounds whose decisions survive, and what they were. */
  classified: Map<string, RoundClass>;
  /** Rounds the lever started, from the pull log. */
  pulled: Set<string>;
  /** The span the ids cover, from the stores that date them. */
  span: Span;
}

/** What a round's decisions say it was, or null when the record cannot say. */
export function classOf(sources: readonly (string | undefined)[]): RoundClass | null {
  if (sources.length === 0) return null;
  if (sources.includes("serv")) return "reasoned";
  if (sources.includes("learned")) return "learned";
  if (sources.every((s) => s === undefined)) return null;
  return "instinct";
}

const classFromRound = (round: RoundRow): RoundClass | null => classOf((round.agents ?? []).map((a) => a.source));
const classFromPlan = (row: PlanRow): RoundClass | null => classOf((row.plan?.decisions ?? []).map((d) => d.source));

/**
 * Every round the stores can still name, dated where possible and classified
 * where the decisions survive.
 *
 * A floor rather than a count: a round in which no money moved, nobody was
 * wrecked, nobody picked and nobody pulled leaves no trace at all once its
 * record ages out, so the real number is this or more.
 */
export function lifetimeRounds(stores: Stores): LifetimeRounds {
  const ids = new Set<string>();
  const dated = new Map<string, number>();
  const bySource: Record<string, number> = {};
  const classified = new Map<string, RoundClass>();
  const pulled = new Set<string>();

  const note = (source: string, id: string | undefined | null, at?: string | null): void => {
    if (id === undefined || id === null || id.length === 0) return;
    if (!ids.has(id)) bySource[source] = (bySource[source] ?? 0) + 1;
    ids.add(id);
    const when = at === undefined || at === null ? NaN : Date.parse(at);
    if (Number.isFinite(when) && (!dated.has(id) || when < dated.get(id)!)) dated.set(id, when);
  };

  for (const round of stores.rounds ?? []) {
    note("the round store", round.roundId, round.createdAt);
    const verdict = classFromRound(round);
    if (verdict !== null) classified.set(round.roundId, verdict);
  }
  for (const transfer of stores.transfers ?? []) note("the ledger", transfer.roundId, transfer.createdAt);
  for (const wreck of stores.wrecks ?? []) note("the wreck store", wreck.roundId, wreck.at);
  for (const line of stores.pulls ?? []) {
    const id = typeof line.roundId === "string" ? line.roundId : null;
    note("the pull log", id, typeof line.at === "string" ? line.at : null);
    if (id !== null) pulled.add(id);
  }
  for (const line of stores.picks ?? []) {
    const id = typeof line.roundId === "string" ? line.roundId : typeof line.after === "string" ? line.after : null;
    note("the pick log", id, typeof line.at === "string" ? line.at : null);
  }
  // A quoted plan carries its decisions, so it can class a round whose record
  // has long aged out. There are only ever a few, and they are the only reason
  // any round before the window can be called reasoned at all.
  for (const row of stores.plans ?? []) {
    const id = row.plan?.roundId ?? null;
    note("the plan store", id, row.quotedAt ?? null);
    const verdict = classFromPlan(row);
    if (id !== null && verdict !== null && !classified.has(id)) classified.set(id, verdict);
  }
  // The round on screen and the one before it, in case both are outside
  // everything else. Cheap, and it keeps the newest round in the count.
  for (const round of [stores.arena?.round, stores.arena?.last]) {
    if (round?.roundId) note("the arena state", round.roundId, null);
  }

  return { ids, dated, bySource, classified, pulled, span: spanOf([...dated.values()]) };
}

/** How the classified rounds split, and how many could not be classified. */
export function classSplit(life: LifetimeRounds): { reasoned: number; learned: number; instinct: number; unclassified: number } {
  let reasoned = 0;
  let learned = 0;
  let instinct = 0;
  for (const verdict of life.classified.values()) {
    if (verdict === "reasoned") reasoned += 1;
    else if (verdict === "learned") learned += 1;
    else instinct += 1;
  }
  return { reasoned, learned, instinct, unclassified: life.ids.size - life.classified.size };
}
