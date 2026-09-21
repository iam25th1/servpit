// The graveyard, one page at a time.
//
// The stage is a fixed 1280 by 720 and does not scroll, so a list that grows
// without limit has to be paged rather than allowed to run off the bottom.
// Eight slabs fill the slab wall; everything past that is an older page.
//
// Pure, so the paging is testable without a browser. The cause is decided on
// the server by overReached, which lives beside node's file system and may
// not be imported here.

/** One retired agent, as the graveyard route reports it. Chips, not wei. */
export interface GraveShape {
  walletId: string;
  identityId: string;
  name: string;
  /** The replacement face, or null for one of the six who started. */
  face: string | null;
  cause: "over-reached" | "ran out of credit";
  roundsSurvived: number;
  wins: number;
  peakBalance: number;
  debtAtDeath: number;
  /** When it died, as an ISO timestamp. Sorts the wall. */
  at: string;
}

export interface GravePage {
  rows: GraveShape[];
  /** The page actually shown, which is not always the one asked for. */
  page: number;
  total: number;
  /** "9 to 16 of 37", or what to say when the wall is bare. */
  label: string;
  hasOlder: boolean;
  hasNewer: boolean;
}

export const GRAVES_PER_PAGE = 8;

/**
 * One page of the wall, newest first.
 *
 * A page past the end comes back as the first page rather than as an empty
 * slab wall: the only way to ask for one is a graveyard that shrank under a
 * viewer, and showing nothing would read as a bug.
 */
export function graveyardPage(graves: readonly GraveShape[], page: number): GravePage {
  const sorted = [...graves].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const pages = Math.max(1, Math.ceil(sorted.length / GRAVES_PER_PAGE));
  const safe = Number.isSafeInteger(page) && page > 0 && page < pages ? page : 0;
  const start = safe * GRAVES_PER_PAGE;
  const rows = sorted.slice(start, start + GRAVES_PER_PAGE);
  return {
    rows,
    page: safe,
    total: sorted.length,
    label: sorted.length === 0 ? "nobody yet" : `${start + 1} to ${start + rows.length} of ${sorted.length}`,
    hasOlder: start + rows.length < sorted.length,
    hasNewer: safe > 0,
  };
}
