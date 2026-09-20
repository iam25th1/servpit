// How long a tick lasts on screen, and everything that has to move with it.
//
// The engine emits ticks with no duration. The tick duration is a playback
// decision and lives here alone, so changing it cannot leave a hitstop or a
// walk cycle behind at the old beat.
//
// Two kinds of duration exist in the renderer and only one of them belongs
// here:
//
//   Tied to the beat. Hitstop, the impact flash, the knockback settle, the
//   punch settle, the attack pose and the corpse fade are punctuation on a
//   tick. They read as a fraction of the beat, so they are expressed as one
//   and converted below. At a 200 ms tick a two frame flash was a sixth of
//   the window; at 320 ms the same two frames would be a tenth, and the hit
//   would read as a flick rather than a beat.
//
//   The art's own cadence. An explosion sheet, a smoke puff and a particle
//   lifetime were drawn at a rate the artist chose. Slowing them because the
//   fight slowed would play the artwork back in slow motion, so those stay
//   in absolute milliseconds and are deliberately not listed here.

/**
 * Milliseconds per tick. Raised from 200 to 320 in phase 8: at 200 a 37 tick
 * round played in 7.4 seconds and individual exchanges were too quick to
 * follow.
 */
export const TICK_MS = 320;

/**
 * Nominal render frame, 60 Hz. The juice layer counts render frames rather
 * than milliseconds, so a beat relative duration is converted through this.
 * It is nominal: on a 120 Hz display a frame is really half as long, which
 * is a property the juice layer already had and which this does not change.
 */
export const FRAME_MS = 1000 / 60;

/** Render frames in one tick at the nominal frame rate. */
export const FRAMES_PER_TICK = TICK_MS / FRAME_MS;

/** A duration given in ticks, as a whole number of render frames, never zero. */
export function ticksToFrames(ticks: number): number {
  if (!Number.isFinite(ticks) || ticks <= 0) throw new RangeError(`a duration must be a positive number of ticks, got ${ticks}`);
  return Math.max(1, Math.round(ticks * FRAMES_PER_TICK));
}

/**
 * Walk frames the arena plays per tick. An actor crosses one tile per tick,
 * so the gait has to slow with the tick or the feet cycle faster than the
 * travel and the character moonwalks.
 */
export const WALK_FRAMES_PER_TICK = 2;

/** Milliseconds per walk frame, derived so the gait matches the travel. */
export const WALK_FRAME_MS = TICK_MS / WALK_FRAMES_PER_TICK;
