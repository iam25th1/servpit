// Slot machine timing and feel. Every number a player can feel is here, not
// buried in code, so the machine can be tuned without a rebuild of logic.
//
// The shape of a pull, in order:
//   lever travel -> commit -> dead air -> reel 1 -> gap -> reel 2 -> gap
//   (plus near miss hold) -> reel 3 -> payoff
//
// The near miss hold is the one rule that makes this read as a slot rather
// than three timers: when reels 1 and 2 match, reel 3 hangs on a beat longer.

export interface ReelTiming {
  /** Milliseconds the reel accelerates to full speed. */
  spinUpMs: number;
  /** Symbols per second at full speed. */
  spinSymbolsPerSecond: number;
  /** When reel 1 stops, measured from the moment reel 1 starts. */
  firstStopMs: number;
  /** Beat between reel 1 stopping and reel 2 stopping. */
  gapBeforeReel2Ms: number;
  /** Beat between reel 2 stopping and reel 3 stopping. Longer than the second gap. */
  gapBeforeReel3Ms: number;
  /** Extra hold on reel 3 when reels 1 and 2 landed on the same symbol. */
  nearMissHoldMs: number;
  /** Milliseconds the reel eases from full speed to rest. */
  settleMs: number;
  /** Rows of symbols drawn above and below the window, for the strip. */
  stripRadius: number;
}

export interface LeverTiming {
  /** Travel time down, in milliseconds. About 8 frames at 60fps. */
  travelMs: number;
  /** Fraction of travel after which the pull is locked and input stops mattering. */
  commitAt: number;
  /** Quiet after commit before reel 1 starts. The pressure lives here. */
  deadAirMs: number;
  /** Travel time back up after the round is handed off. */
  returnMs: number;
}

export interface SlotConfig {
  reels: ReelTiming;
  lever: LeverTiming;
}

export const DEFAULT_SLOT: SlotConfig = {
  reels: {
    spinUpMs: 220,
    spinSymbolsPerSecond: 22,
    firstStopMs: 900,
    gapBeforeReel2Ms: 420,
    // Longer than the gap before reel 2: the field narrows, the wait lengthens.
    gapBeforeReel3Ms: 700,
    nearMissHoldMs: 400,
    settleMs: 260,
    stripRadius: 2,
  },
  lever: {
    travelMs: 133,
    commitAt: 0.55,
    deadAirMs: 380,
    returnMs: 260,
  },
};
