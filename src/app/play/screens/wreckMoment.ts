// What the screen says when a seat is emptied.
//
// A wreck is the end of somebody, so it gets sentences rather than a row in a
// table: what it was, how long it lasted, what the lender took, and who is
// sitting in its chair by the end of the round. The treatment that carries
// them is in the shell; this decides the words.
//
// Pure, so the wording is testable without a browser, and chips throughout
// because nobody reads wei.

/** One wreck, as the run route reports it. */
export interface WreckShape {
  walletId: string;
  name: string;
  /** The face it wore, or null for one of the six who started. */
  face: string | null;
  trigger: string;
  /** Decided on the server by overReached, which reads the whole record. */
  overReached: boolean;
  debtAtDeathWei: string;
  seizedWei: string;
  writtenOffWei: string;
  peakBalanceWei: string;
  borrowedWei: string;
  roundsSurvived: number;
  wins: number;
}

/** Whoever took the emptied seat, as the run route reports it. */
export interface ReplacementShape {
  walletId: string;
  name: string;
  face: string | null;
  /** Its own first line, in its own voice. */
  arrival: string;
  fundedWei: string;
}

export interface WreckMoment {
  walletId: string;
  name: string;
  face: string | null;
  /** "over-reached" or "ran out of credit", the same two words the graveyard uses. */
  cause: string;
  life: string;
  /** What the lender took and lost. Null when it owed nothing. */
  toll: string | null;
  heir: { name: string; face: string | null; arrival: string; staked: string } | null;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function wreckMoments(wrecks: readonly WreckShape[], replacements: readonly ReplacementShape[], perChipWei: bigint): WreckMoment[] {
  const per = perChipWei > 0n ? perChipWei : 1n;
  const chips = (wei: string): bigint => BigInt(wei) / per;
  return wrecks.map((w) => {
    const seized = chips(w.seizedWei);
    const written = chips(w.writtenOffWei);
    const owed = chips(w.debtAtDeathWei);
    // Whoever is in this seat now. Keyed by the seat, because that is what
    // the wallet, the debt and every idempotency key belong to.
    const taker = replacements.find((r) => r.walletId === w.walletId) ?? null;
    const funded = taker ? chips(taker.fundedWei) : 0n;
    return {
      walletId: w.walletId,
      name: w.name,
      face: w.face,
      cause: w.overReached ? "over-reached" : "ran out of credit",
      life: `${plural(w.roundsSurvived, "round", "rounds")}, ${w.wins === 0 ? "no wins" : plural(w.wins, "win", "wins")}, ${chips(w.peakBalanceWei)} chips at its best.`,
      toll:
        owed <= 0n
          ? null
          : seized <= 0n
            ? `It had nothing left, so Marrow wrote off all ${written}.`
            : `Marrow took the ${seized} chips it had left and wrote off ${written}.`,
      heir: taker
        ? {
            name: taker.name,
            face: taker.face,
            arrival: taker.arrival,
            staked: funded > 0n ? `${taker.name} sits down with ${funded} chips from the operator.` : `${taker.name} sits down with nothing. The operator had none to give.`,
          }
        : null,
    };
  });
}
