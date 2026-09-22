"use client";

// Wall clock, for the two things in arena mode that are not animation.
//
// A countdown to the next round is a clock, and where to start a fight that
// began before a viewer arrived is a clock. Neither is the canvas Timeline's
// job: the Timeline is the clock for motion, it runs in round time rather
// than wall time, and it does not exist at all while the pit is resting.
//
// This file and arenaFeed.ts are the only two in the play screen allowed a
// timer, which the guard in src/render/timeline.test.ts names and explains.
// Everything that moves on a canvas still comes from the Timeline.

import { useEffect, useState } from "react";

/** A second, which is the resolution a countdown is read at. */
export const TICK_MS = 1_000;

/**
 * The current wall time, refreshed on a tick.
 *
 * Returns a number rather than a Date so the pure helpers that read it stay
 * pure: they take a time and return an offset, and this is the only thing in
 * the client that knows what time it is now.
 */
export function useWallClock(enabled: boolean, tickMs: number = TICK_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    // Only on the tick. Setting it here as well would be a render inside a
    // render for a number that is about to arrive anyway.
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [enabled, tickMs]);
  return now;
}

/**
 * The moment this is called.
 *
 * For the one thing a ticking clock is too coarse for: seeking into a fight
 * that started before the viewer arrived, where being a second out is a
 * second of the fight nobody sees. Here rather than at the call site so the
 * play screen keeps its rule about where a clock may live.
 */
export function readNow(): number {
  return Date.now();
}
