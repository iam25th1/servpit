import { describe, expect, it } from "vitest";
import { HEARTBEAT_MARGIN_MS, health } from "./health";
import type { ArenaPhase, ArenaRound, ArenaState } from "./state";

const AT = "2026-09-22T00:00:00.000Z";
const T0 = Date.parse(AT);
const INTERVAL = 3_600_000;

const round = (phase: ArenaPhase, at = AT): ArenaRound => ({
  roundId: "r-1",
  startedAt: at,
  phase,
  phases: [{ phase, at }],
  network: "fake",
  backend: "fake",
  entrants: 24,
  bots: 18,
  stakeChips: 10,
  weiPerChip: "1000000000000",
  decisions: [],
  loans: [],
  refusals: [],
  bank: null,
  entries: [],
});

const state = (extra: Partial<ArenaState> = {}): ArenaState => ({
  round: round("fight"),
  last: null,
  paused: false,
  nextRoundAt: null,
  updatedAt: AT,
  ...extra,
});

describe("whether the worker is there", () => {
  it("is alive while the heartbeat is inside an interval and a margin", () => {
    expect(health(state(), T0 - INTERVAL, INTERVAL, "fake", T0).worker).toBe("alive");
    expect(health(state(), T0 - INTERVAL - HEARTBEAT_MARGIN_MS, INTERVAL, "fake", T0).worker).toBe("alive");
  });

  it("is stale once it is past that, whatever the last round says", () => {
    const answer = health(state({ last: round("result") }), T0 - INTERVAL - HEARTBEAT_MARGIN_MS - 1, INTERVAL, "fake", T0);
    expect(answer.worker).toBe("stale");
    expect(answer.ok).toBe(false);
  });

  it("is unknown with no lock at all, which is also a clean stop", () => {
    expect(health(state(), null, INTERVAL, "fake", T0).worker).toBe("unknown");
  });

  it("is not a failure when an operator paused it on purpose", () => {
    expect(health(state({ paused: true }), null, INTERVAL, "fake", T0).ok).toBe(true);
    expect(health(state({ paused: true }), null, INTERVAL, "fake", T0).pit).toBe("paused");
  });
});

describe("what the pit is doing", () => {
  it("is running while a round is in any phase of being played", () => {
    for (const phase of ["planning", "deciding", "banking", "settling", "reels", "backing", "fight", "result"] as ArenaPhase[]) {
      expect(health(state({ round: round(phase) }), T0, INTERVAL, "fake", T0).pit, phase).toBe("running");
    }
  });

  it("is resting between rounds and after a failed one", () => {
    for (const phase of ["resting", "failed"] as ArenaPhase[]) {
      expect(health(state({ round: round(phase) }), T0, INTERVAL, "fake", T0).pit, phase).toBe("resting");
    }
  });

  it("is unknown before the first round has ever started", () => {
    expect(health(state({ round: null }), T0, INTERVAL, "fake", T0).pit).toBe("unknown");
  });
});

describe("the clock a watcher reads", () => {
  it("counts seconds since the last round and until the next", () => {
    const answer = health(
      state({ last: round("result", new Date(T0 - 90_000).toISOString()), nextRoundAt: new Date(T0 + 120_000).toISOString() }),
      T0,
      INTERVAL,
      "fake",
      T0,
    );
    expect(answer.sinceLastRoundSeconds).toBe(90);
    expect(answer.nextRoundInSeconds).toBe(120);
  });

  it("never counts backwards once a round is overdue", () => {
    expect(health(state({ nextRoundAt: new Date(T0 - 10_000).toISOString() }), T0, INTERVAL, "fake", T0).nextRoundInSeconds).toBe(0);
  });

  it("says nothing about rounds that have not happened", () => {
    const answer = health(state(), T0, INTERVAL, "fake", T0);
    expect(answer.sinceLastRoundSeconds).toBeNull();
    expect(answer.nextRoundInSeconds).toBeNull();
  });
});

describe("what it does not say", () => {
  it("carries no balance, no address, no pid and no path", () => {
    const answer = health(state({ last: round("result"), nextRoundAt: AT }), T0, INTERVAL, "fake", T0);
    expect(Object.keys(answer).sort()).toEqual(["network", "nextRoundInSeconds", "ok", "pit", "sinceLastRoundSeconds", "worker"]);
    const body = JSON.stringify(answer);
    expect(body).not.toMatch(/0x|wei|chips|pid|\/|balance/i);
  });
});
