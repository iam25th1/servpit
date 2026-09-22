import { describe, expect, it } from "vitest";
import { fightOffsetMs, phaseMark, secondsUntil, watchDecisions, watchEntries, watchOccupants, watchState, type ArenaFeedRound, type ArenaFeedView } from "./arenaScreens";
import type { ArenaPhase } from "@/server/arena/state";

const AT = "2026-09-22T00:00:00.000Z";
const T0 = Date.parse(AT);

const round = (phase: ArenaPhase, extra: Partial<ArenaFeedRound> = {}): ArenaFeedRound => ({
  roundId: "r-1",
  startedAt: AT,
  phase,
  phases: [{ phase, at: AT }],
  network: "fake",
  backend: "fake",
  entrants: 24,
  bots: 20,
  stakeChips: 10,
  weiPerChip: "1000000000000",
  decisions: [
    { agentId: "atlas", name: "Atlas", face: null, enter: true, stake: 10, reason: "I am in.", source: "serv", balance: 40, debt: 0 },
    { agentId: "blaze", name: "Vex", face: "NinjaFire", enter: false, stake: 0, reason: "Sitting out.", source: "heuristic", balance: 9, debt: 2 },
  ],
  loans: [],
  refusals: [],
  bank: null,
  entries: [{ agentId: "atlas", amountWei: "10000000000000", txHash: "0xabc", link: null }],
  ...extra,
});

const view = (r: ArenaFeedRound | null, extra: Partial<ArenaFeedView["pit"]> = {}, last: ArenaFeedRound | null = null): ArenaFeedView => ({
  pit: { network: "fake", backend: "fake", paused: false, nextRoundAt: null, updatedAt: AT, ...extra },
  round: r,
  last,
});

describe("which screen a phase is", () => {
  it("puts the deciding phases on the lineup, where the reasons land", () => {
    for (const phase of ["planning", "deciding", "banking"] as ArenaPhase[]) {
      expect(watchState(view(round(phase))).screen).toBe("lobby");
    }
  });

  it("puts settling and the draw on the slot screen", () => {
    expect(watchState(view(round("settling"))).screen).toBe("spinning");
    expect(watchState(view(round("reels"))).screen).toBe("spinning");
  });

  it("puts the fight in the arena and the figures on the result", () => {
    expect(watchState(view(round("fight"))).screen).toBe("arena");
    expect(watchState(view(round("result"))).screen).toBe("result");
  });

  it("rests between rounds, with the reason the worker gave", () => {
    const resting = round("resting", { phases: [{ phase: "resting", at: AT, reason: "Nobody could cover a seat this round." }] });
    const state = watchState(view(resting, { nextRoundAt: "2026-09-22T00:10:00.000Z" }));
    expect(state.screen).toBe("resting");
    expect(state.resting).toBe(true);
    expect(state.restReason).toBe("Nobody could cover a seat this round.");
    expect(state.nextRoundAt).toBe("2026-09-22T00:10:00.000Z");
  });

  it("rests on a failed round too, saying what failed", () => {
    const failed = round("failed", { phases: [{ phase: "failed", at: AT, reason: "the chain did not answer" }] });
    expect(watchState(view(failed)).restReason).toBe("the chain did not answer");
  });

  it("shows the last round while there is no live one at all", () => {
    const state = watchState(view(null, { paused: true }, round("result")));
    expect(state.screen).toBe("resting");
    expect(state.round?.roundId).toBe("r-1");
    expect(state.paused).toBe(true);
  });

  it("rests when there is nothing at all, rather than showing a blank round", () => {
    expect(watchState(null).screen).toBe("resting");
    expect(watchState(null).round).toBeNull();
  });
});

describe("joining mid fight", () => {
  const fighting = (startedAt: string, durationMs = 12_000): ArenaFeedRound =>
    round("fight", {
      phases: [
        { phase: "settling", at: AT },
        { phase: "fight", at: startedAt, durationMs },
      ],
      fight: { seed: "s", durationMs, characters: [], log: [], placements: ["agent-atlas"], names: {} },
    });

  it("starts where the fight actually is, not at the beginning", () => {
    expect(fightOffsetMs(fighting(AT), T0 + 4_000)).toBe(4_000);
  });

  it("starts at zero for a viewer who was already there", () => {
    expect(fightOffsetMs(fighting(AT), T0)).toBe(0);
    expect(fightOffsetMs(fighting(AT), T0 - 500)).toBe(0);
  });

  it("never seeks past the end, however far behind the clock is", () => {
    expect(fightOffsetMs(fighting(AT, 12_000), T0 + 60_000)).toBe(12_000);
  });

  it("has no offset when there is no fight to be in", () => {
    expect(fightOffsetMs(round("deciding"), T0)).toBeNull();
    expect(fightOffsetMs(null, T0)).toBeNull();
  });
});

describe("the countdown", () => {
  it("counts whole seconds to the next round", () => {
    expect(secondsUntil("2026-09-22T00:00:30.000Z", T0)).toBe(30);
    expect(secondsUntil("2026-09-22T00:00:30.400Z", T0)).toBe(30);
  });

  it("stops at zero rather than going negative", () => {
    expect(secondsUntil(AT, T0 + 5_000)).toBe(0);
  });

  it("says nothing when nothing is scheduled", () => {
    expect(secondsUntil(null, T0)).toBeNull();
    expect(secondsUntil("not a time", T0)).toBeNull();
  });
});

describe("the shapes the shell already draws", () => {
  it("carries each decision with where its answer came from", () => {
    const rows = watchDecisions(round("deciding"));
    expect(rows[0]).toMatchObject({ agentId: "atlas", name: "Atlas", source: "serv", enter: true });
    expect(rows[1]).toMatchObject({ agentId: "blaze", name: "Vex", source: "heuristic", face: "NinjaFire", debt: 2 });
  });

  it("names every seat for the rows that have not reported yet", () => {
    expect(watchOccupants(round("planning"))).toEqual([
      { agentId: "atlas", name: "Atlas", face: null },
      { agentId: "blaze", name: "Vex", face: "NinjaFire" },
    ]);
  });

  it("turns entries into the buy in rows, named after whoever paid", () => {
    const entries = watchEntries(round("settling"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ agentId: "atlas", name: "Atlas", txHash: "0xabc", applied: true });
  });

  it("finds the latest mark for a phase, not the first", () => {
    const twice = round("resting", {
      phases: [
        { phase: "resting", at: AT, reason: "first" },
        { phase: "planning", at: AT },
        { phase: "resting", at: "2026-09-22T00:05:00.000Z", reason: "second" },
      ],
    });
    expect(phaseMark(twice, "resting")?.reason).toBe("second");
  });
});
