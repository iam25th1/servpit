import { describe, expect, it } from "vitest";
import { DEFAULT_SLOT, type SlotConfig } from "@/config/slot";
import { Lever } from "./lever";

const config = (patch: Partial<SlotConfig["lever"]> = {}): SlotConfig => ({
  ...DEFAULT_SLOT,
  lever: { ...DEFAULT_SLOT.lever, ...patch },
});

const run = (lever: Lever, ms: number, step = 8): void => {
  for (let t = 0; t < ms; t += step) lever.advance(step);
};

describe("Lever travel", () => {
  it("starts up, idle and pullable", () => {
    const lever = new Lever(DEFAULT_SLOT);
    expect(lever.state).toBe("idle");
    expect(lever.progress).toBe(0);
    expect(lever.canPull).toBe(true);
    expect(lever.committed).toBe(false);
  });

  it("travels down over the configured time rather than snapping", () => {
    const lever = new Lever(DEFAULT_SLOT);
    lever.pull();
    expect(lever.progress).toBe(0);
    run(lever, 16);
    const early = lever.progress;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(1);
    run(lever, DEFAULT_SLOT.lever.travelMs);
    expect(lever.progress).toBe(1);
  });

  it("eases rather than moving linearly", () => {
    const lever = new Lever(DEFAULT_SLOT);
    lever.pull();
    const half = DEFAULT_SLOT.lever.travelMs / 2;
    run(lever, half, 1);
    expect(lever.progress).not.toBeCloseTo(0.5, 2);
  });

  it("takes about eight frames of travel at the default", () => {
    const frames = DEFAULT_SLOT.lever.travelMs / (1000 / 60);
    expect(frames).toBeGreaterThanOrEqual(7);
    expect(frames).toBeLessThanOrEqual(9);
  });
});

describe("Lever commit point", () => {
  it("locks partway down, after which input stops mattering", () => {
    const lever = new Lever(DEFAULT_SLOT);
    lever.pull();
    run(lever, DEFAULT_SLOT.lever.travelMs * DEFAULT_SLOT.lever.commitAt * 0.4, 1);
    expect(lever.committed).toBe(false);
    expect(lever.canPull).toBe(false);
    run(lever, DEFAULT_SLOT.lever.travelMs, 1);
    expect(lever.committed).toBe(true);
  });

  it("reports the commit exactly once, for the sound and the lock", () => {
    const lever = new Lever(DEFAULT_SLOT);
    let commits = 0;
    lever.onCommit(() => commits++);
    lever.pull();
    run(lever, 2_000);
    expect(commits).toBe(1);
  });

  it("ignores further pulls once travelling, so a double click cannot double spin", () => {
    const lever = new Lever(DEFAULT_SLOT);
    let commits = 0;
    lever.onCommit(() => commits++);
    expect(lever.pull()).toBe(true);
    expect(lever.pull()).toBe(false);
    run(lever, 40);
    expect(lever.pull()).toBe(false);
    run(lever, 2_000);
    expect(lever.pull()).toBe(false);
    expect(commits).toBe(1);
  });
});

describe("Lever dead air", () => {
  it("holds a configurable quiet between commit and release, with nothing else happening", () => {
    const lever = new Lever(DEFAULT_SLOT);
    let released = false;
    lever.onRelease(() => {
      released = true;
    });
    lever.pull();
    run(lever, DEFAULT_SLOT.lever.travelMs, 1);
    expect(lever.committed).toBe(true);
    expect(lever.state).toBe("deadAir");
    expect(released).toBe(false);
    run(lever, DEFAULT_SLOT.lever.deadAirMs - 40, 1);
    expect(released).toBe(false);
    run(lever, 80, 1);
    expect(released).toBe(true);
    expect(lever.state).toBe("spinning");
  });

  it("keeps the dead air in the 300 to 500 ms band by default", () => {
    expect(DEFAULT_SLOT.lever.deadAirMs).toBeGreaterThanOrEqual(300);
    expect(DEFAULT_SLOT.lever.deadAirMs).toBeLessThanOrEqual(500);
  });

  it("is configurable", () => {
    const lever = new Lever(config({ deadAirMs: 1_000 }));
    let released = false;
    lever.onRelease(() => {
      released = true;
    });
    lever.pull();
    run(lever, DEFAULT_SLOT.lever.travelMs + 600, 1);
    expect(released).toBe(false);
    run(lever, 500, 1);
    expect(released).toBe(true);
  });

  it("does not move the lever during dead air: it is held down, not drifting", () => {
    const lever = new Lever(DEFAULT_SLOT);
    lever.pull();
    run(lever, DEFAULT_SLOT.lever.travelMs, 1);
    const atCommit = lever.progress;
    run(lever, DEFAULT_SLOT.lever.deadAirMs / 2, 1);
    expect(lever.progress).toBe(atCommit);
    expect(atCommit).toBe(1);
  });
});

describe("Lever return", () => {
  it("returns to rest when released for the next pull, and becomes pullable again only at the end", () => {
    const lever = new Lever(DEFAULT_SLOT);
    lever.pull();
    run(lever, 2_000, 1);
    expect(lever.state).toBe("spinning");
    expect(lever.canPull).toBe(false);
    lever.releaseToIdle();
    expect(lever.state).toBe("returning");
    expect(lever.canPull).toBe(false);
    run(lever, DEFAULT_SLOT.lever.returnMs + 20, 1);
    expect(lever.state).toBe("idle");
    expect(lever.progress).toBe(0);
    expect(lever.canPull).toBe(true);
    expect(lever.committed).toBe(false);
  });
});
