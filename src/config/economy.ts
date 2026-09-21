// The shape of the economy: what a prize is made of, and where it goes when
// nobody real wins.
//
// THE OLD PRIZE WAS INSOLVENT BY CONSTRUCTION. computePot charged every seat,
// all twenty four, and only the five or six real agents ever paid anything on
// chain. The other eighteen were house bots contributing nothing, so the pot
// wallet had to make up the difference out of its own balance every time an
// agent won.
//
// Measured on the live pot: it promised a 240 chip prize while agents paid in
// about 50 chips a round, against a 25 per cent chance an agent wins. That is
// 60 chips expected out against 50 in, so the pot drained about 10 chips a
// round and had enough for one more payout.
//
// The prize is now exactly what agents actually paid in, plus whatever rolled
// over from rounds nobody real won. The pot can always pay it, because the
// pot is holding it.

/** Share of an unclaimed pot the bank takes when a house bot wins. */
export const DEFAULT_BANK_SHARE_ON_HOUSE_WIN = 0.5;

export function bankShareOnHouseWin(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SERVPIT_BANK_SHARE_ON_HOUSE_WIN?.trim();
  if (raw === undefined || raw.length === 0) return DEFAULT_BANK_SHARE_ON_HOUSE_WIN;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`SERVPIT_BANK_SHARE_ON_HOUSE_WIN must be between 0 and 1, got ${raw}`);
  }
  return value;
}
