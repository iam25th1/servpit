// The fighters board, as a viewer reads it.
//
// Two sources, because a fighter exists before it has a record. A claim is a
// line in the claims log the moment somebody makes it; a record is written by
// the settle path once a round with that fighter in it is over. The board used
// to list records only, so a visitor who had just claimed a fighter opened it
// and was told nobody had claimed one yet, which read as the claim failing.
//
// So every seat claimed right now is on the board, with an empty record until
// its first round, and a record whose seat has since gone back stays on it as
// history. Pure: rows in, a page out.

import type { CareerRow } from "./careerStore";

/** A row of the board: a record, and whether its seat is still in the pit. */
export interface FighterBoardRow extends CareerRow {
  /** True while this handle holds a claimed seat, so it fights next round. */
  inPit: boolean;
}

export interface FighterBoardPage {
  rows: FighterBoardRow[];
  page: number;
  pages: number;
  /** Every row on the board, claimed or retired. */
  total: number;
  /** Seats claimed right now, which is the number a visitor asks about. */
  claimed: number;
}

/** A claimed seat, as the claims log has it. */
export interface ClaimedSeatRow {
  handle: string;
  name: string;
  face: string;
}

/** A record for a seat that has not fought yet. */
function emptyRecord(seat: ClaimedSeatRow): CareerRow {
  return { handle: seat.handle, name: seat.name, face: seat.face, rounds: 0, wins: 0, best: 0, kills: 0, streak: 0, longest: 0 };
}

/**
 * Every fighter, best record first, new ones last.
 *
 * The record's own order comes first because it is already the board's order:
 * wins, then best placement, then kills. A claim with no rounds yet has
 * nothing to rank on, so those go after everybody who has fought, oldest
 * claim first, which is the order the claims log gives them in.
 */
export function fighterBoardRows(careers: readonly CareerRow[], claims: readonly ClaimedSeatRow[]): FighterBoardRow[] {
  const claimed = new Map(claims.map((seat) => [seat.handle, seat]));
  const recorded = new Set(careers.map((row) => row.handle));
  const fought: FighterBoardRow[] = careers.map((row) => {
    const seat = claimed.get(row.handle);
    // The name and face the seat carries now, when it is still claimed: a
    // visitor who claimed again under a new name reads as that name.
    return seat ? { ...row, name: seat.name, face: seat.face, inPit: true } : { ...row, inPit: false };
  });
  const fresh = claims.filter((seat) => !recorded.has(seat.handle)).map((seat) => ({ ...emptyRecord(seat), inPit: true }));
  return [...fought, ...fresh];
}

/** One page of the board, counted from one, with the claimed count beside it. */
export function fighterBoardPage(careers: readonly CareerRow[], claims: readonly ClaimedSeatRow[], page: number, size: number): FighterBoardPage {
  const all = fighterBoardRows(careers, claims);
  const pages = Math.max(1, Math.ceil(all.length / size));
  const at = Math.min(Math.max(1, Math.floor(Number.isFinite(page) ? page : 1)), pages);
  return { rows: all.slice((at - 1) * size, at * size), page: at, pages, total: all.length, claimed: claims.length };
}

/** One handle's row, wherever it sits, or null when it has neither a record nor a seat. */
export function fighterBoardRow(careers: readonly CareerRow[], claims: readonly ClaimedSeatRow[], handle: string): FighterBoardRow | null {
  return fighterBoardRows(careers, claims).find((row) => row.handle === handle) ?? null;
}
