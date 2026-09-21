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

/**
 * Share of an unclaimed pot the bank takes when a house bot wins.
 *
 * Zero while no bank wallet exists. At zero every unclaimed prize rolls into
 * the next round, nothing is sent anywhere, and the pot can only ever pay out
 * what agents paid in. Raising it needs somewhere to send the share, so
 * assertBankShareIsPayable stops a run that has one set with no bank.
 */
export const DEFAULT_BANK_SHARE_ON_HOUSE_WIN = 0;

export function bankShareOnHouseWin(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SERVPIT_BANK_SHARE_ON_HOUSE_WIN?.trim();
  if (raw === undefined || raw.length === 0) return DEFAULT_BANK_SHARE_ON_HOUSE_WIN;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`SERVPIT_BANK_SHARE_ON_HOUSE_WIN must be between 0 and 1, got ${raw}`);
  }
  return value;
}

/**
 * Stops a run that would owe the bank a share with no bank wallet to pay it.
 *
 * Loudly, at startup, rather than quietly rolling the share over. A share
 * that silently becomes rollover is a number in a config file that does not
 * mean what it says, on a money surface.
 */
export function assertBankShareIsPayable(hasBankWallet: boolean, env: NodeJS.ProcessEnv = process.env): void {
  const share = bankShareOnHouseWin(env);
  if (share > 0 && !hasBankWallet) {
    throw new Error(
      `SERVPIT_BANK_SHARE_ON_HOUSE_WIN is ${share} but there is no bank wallet to send it to. ` +
        "Set it to 0 until a bank wallet exists, or add one.",
    );
  }
}
