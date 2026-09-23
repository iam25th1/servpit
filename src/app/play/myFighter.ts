// The viewer's own fighter, on screen.
//
// Everything here is pure, so what a viewer is told about their own fighter
// is testable without a browser and cannot drift from what the round
// recorded. The same two facts the career is built from are used: the order
// the round ended in, and the deaths the log names.

import type { ArenaFeedRound } from "./arenaScreens";

/** A claimed seat as the arena publishes it. */
export interface ClaimedSeat {
  handle: string;
  name: string;
  face: string;
  entrantId: string;
}

/** A record as the board keeps it. */
export interface CareerRow {
  handle: string;
  name: string;
  face: string;
  rounds: number;
  wins: number;
  best: number;
  kills: number;
  streak: number;
  longest: number;
}

/**
 * The names the arena draws a plate over.
 *
 * The six agents, which the round already names, plus this viewer's own
 * fighter and nobody else's. Twenty four plates is noise; one is the thing
 * a viewer came to watch.
 */
export function plateNames(round: ArenaFeedRound | null, mine: ClaimedSeat | null): Record<string, string> {
  const names = { ...(round?.fight?.names ?? {}) };
  if (mine && round?.fighters?.some((f) => f.entrantId === mine.entrantId)) names[mine.entrantId] = mine.name;
  return names;
}

/** How a fighter did in one finished round. */
export interface RoundLine {
  placement: number;
  field: number;
  kills: number;
  won: boolean;
}

/** What this viewer's fighter did in the round on screen, or null. */
export function myRound(round: ArenaFeedRound | null, mine: ClaimedSeat | null): RoundLine | null {
  const fight = round?.fight;
  if (!fight || !mine) return null;
  const placements = fight.placements ?? [];
  const index = placements.indexOf(mine.entrantId);
  if (index === -1) return null;
  const log = Array.isArray(fight.log) ? (fight.log as Array<{ type?: string; target?: string | null }>) : [];
  let kills = 0;
  for (const event of log) if (event?.type === "death" && event.target === mine.entrantId) kills += 1;
  return { placement: index + 1, field: placements.length, kills, won: index === 0 };
}

/** The ordinal a person would say: 1st, 2nd, 3rd, 11th. */
export function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  const last = n % 10;
  return `${n}${last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

/**
 * How the viewer's fighter did, in a sentence, or null when it was not in
 * the round or there is nothing to say yet.
 */
export function myRoundLine(name: string, round: RoundLine | null, streak: number | null): string | null {
  if (round === null) return null;
  const kills = round.kills === 0 ? "no kills" : round.kills === 1 ? "1 kill" : `${round.kills} kills`;
  const run = streak && streak > 1 ? ` ${streak} rounds in the top half in a row.` : "";
  if (round.won) return `${name} won it, with ${kills}.${run}`;
  return `${name} finished ${ordinal(round.placement)} of ${round.field}, with ${kills}.${run}`;
}

/** The fighter's record in a sentence, for the quiet screen. */
export function careerLine(row: CareerRow | null): string | null {
  if (!row || row.rounds === 0) return null;
  const rounds = row.rounds === 1 ? "1 round" : `${row.rounds} rounds`;
  const wins = row.wins === 1 ? "1 win" : `${row.wins} wins`;
  const kills = row.kills === 1 ? "1 kill" : `${row.kills} kills`;
  return `${row.name}: ${rounds}, ${wins}, best ${ordinal(row.best)}, ${kills}, streak ${row.streak} and a longest of ${row.longest}.`;
}
