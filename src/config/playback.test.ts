import { describe, expect, it } from "vitest";
import { FRAMES_PER_TICK, FRAME_MS, TICK_MS, WALK_FRAME_MS, WALK_FRAMES_PER_TICK, ticksToFrames } from "./playback";

describe("the tick duration", () => {
  it("is 320 ms", () => {
    expect(TICK_MS).toBe(320);
  });

  it("is the only place the duration is written down", () => {
    // Everything beat relative derives from it, so raising it again cannot
    // leave a hitstop or a walk cycle behind at the old beat.
    expect(FRAMES_PER_TICK).toBeCloseTo(TICK_MS / FRAME_MS, 6);
    expect(WALK_FRAME_MS).toBe(TICK_MS / WALK_FRAMES_PER_TICK);
  });
});

describe("ticksToFrames", () => {
  it("converts a fraction of a tick to whole render frames", () => {
    expect(ticksToFrames(1)).toBe(19);
    expect(ticksToFrames(0.5)).toBe(10);
    expect(ticksToFrames(0.25)).toBe(5);
  });

  it("never rounds a real duration down to nothing", () => {
    // A frame count of zero is a timer that never runs, which is silently
    // no effect at all rather than a short one.
    expect(ticksToFrames(0.001)).toBe(1);
  });

  it("scales with the tick, which is the whole point", () => {
    expect(ticksToFrames(2)).toBe(38);
    expect(ticksToFrames(2)).toBeGreaterThan(ticksToFrames(1));
    // At the old 200 ms tick one tick was 12 frames. The same fraction now
    // buys more frames, which is what keeps the beat reading the same.
    expect(ticksToFrames(0.25)).toBeGreaterThan(Math.round(0.25 * (200 / FRAME_MS)));
  });

  it("refuses a duration that is not a positive number of ticks", () => {
    expect(() => ticksToFrames(0)).toThrow(RangeError);
    expect(() => ticksToFrames(-1)).toThrow(RangeError);
    expect(() => ticksToFrames(Number.NaN)).toThrow(RangeError);
  });
});
