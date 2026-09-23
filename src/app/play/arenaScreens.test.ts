import { describe, expect, it } from "vitest";
import { fightOffsetMs, phaseMark, pulledLine, reasoningLine, secondsUntil, watchDecisions, watchEntries, watchOccupants, watchState, type ArenaFeedRound, type ArenaFeedView } from "./arenaScreens";
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

  it("shows the finished round while resting, since the live copy has no result", () => {
    // A round keeps its id into the resting phase, and the projection strips
    // the result from a round that is still live. The whole one is in last.
    const live = round("resting", { phases: [{ phase: "resting", at: AT }] });
    const finished = round("result", { result: { winner: "agent-atlas", potWei: "60000000000000" } });
    const state = watchState(view(live, {}, finished));
    expect(state.screen).toBe("resting");
    expect(state.round?.result?.winner).toBe("agent-atlas");
  });

  it("keeps the live round when the last one on file is an older round", () => {
    const live = round("resting");
    const older = round("result", { roundId: "r-0", result: { winner: "agent-atlas" } });
    expect(watchState(view(live, {}, older)).round?.roundId).toBe("r-1");
    expect(watchState(view(live, {}, older)).round?.result).toBeUndefined();
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

describe("saying whether this round is reasoned", () => {
  it("says so plainly when every agent reasoned", () => {
    const reasoned = round("deciding", { decisions: round("deciding").decisions.map((d) => ({ ...d, source: "serv" })) });
    expect(reasoningLine(reasoned, false)).toBe("Agents are reasoning with SERV this round.");
  });

  it("says so plainly when none did", () => {
    const instinct = round("deciding", { decisions: round("deciding").decisions.map((d) => ({ ...d, source: "heuristic" })) });
    expect(reasoningLine(instinct, false)).toBe("Agents are running on instinct this round.");
  });

  it("counts the mixture rather than rounding it to one or the other", () => {
    const mixed = round("deciding");
    expect(reasoningLine(mixed, false)).toBe("1 of 2 agents reasoned with SERV this round.");
  });

  it("is in the past tense between rounds, because the round is over", () => {
    const done = round("resting", { decisions: round("resting").decisions.map((d) => ({ ...d, source: "serv" })) });
    expect(reasoningLine(done, true)).toBe("Agents reasoned with SERV last round.");
  });

  it("says nothing before anybody has answered", () => {
    expect(reasoningLine(round("planning", { decisions: [] }), false)).toBeNull();
    expect(reasoningLine(null, false)).toBeNull();
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

describe("pulledLine", () => {
  const pulled = (pulledBy: string | null | undefined): ArenaFeedRound =>
    ({ roundId: "r-1", startedAt: "", phase: "deciding", phases: [], network: "fake", backend: "fake", entrants: 24, bots: 20, stakeChips: 10, weiPerChip: "1", decisions: [], loans: [], refusals: [], bank: null, entries: [], pulledBy }) as ArenaFeedRound;

  it("names the handle that asked for the round", () => {
    expect(pulledLine(pulled("ash"), false)).toBe("ash pulled this round.");
  });

  it("says it in the past while the pit rests, like the reasoning line", () => {
    expect(pulledLine(pulled("ash"), true)).toBe("ash pulled the last round.");
  });

  it("says nothing about a round the interval started", () => {
    expect(pulledLine(pulled(null), false)).toBeNull();
    expect(pulledLine(pulled(undefined), false)).toBeNull();
    expect(pulledLine(null, false)).toBeNull();
  });
});
