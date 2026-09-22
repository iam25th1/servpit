import { describe, expect, it } from "vitest";
import { REPLAY_BUYIN_MS, REPLAY_LINEUP_MS, REPLAY_REELS_MS, replayDurationMs, replayFrame, replayableRound } from "./arenaReplay";
import { fightOffsetMs, type ArenaFeedRound, type ArenaFeedView } from "./arenaScreens";
import type { ArenaPhase } from "@/server/arena/state";

const AT = "2026-09-22T00:00:00.000Z";
const FIGHT_MS = 12_000;

const round = (phase: ArenaPhase, extra: Partial<ArenaFeedRound> = {}): ArenaFeedRound => ({
  roundId: "r-1",
  startedAt: AT,
  phase,
  phases: [{ phase, at: AT }],
  network: "fake",
  backend: "fake",
  entrants: 24,
  bots: 18,
  stakeChips: 10,
  weiPerChip: "1000000000000",
  decisions: [{ agentId: "atlas", name: "Atlas", face: null, enter: true, stake: 10, reason: "I am in.", source: "serv", balance: 40, debt: 0 }],
  loans: [],
  refusals: [],
  bank: null,
  entries: [],
  ...extra,
});

const finished = (extra: Partial<ArenaFeedRound> = {}): ArenaFeedRound =>
  round("result", {
    fight: { seed: "s", durationMs: FIGHT_MS, characters: [], log: [{ t: 1 }], placements: ["agent-atlas"], names: {} },
    result: { winner: "agent-atlas" },
    ...extra,
  });

const view = (live: ArenaFeedRound | null, last: ArenaFeedRound | null): ArenaFeedView => ({
  pit: { network: "fake", backend: "fake", paused: false, nextRoundAt: null, updatedAt: AT },
  round: live,
  last,
});

describe("what may be replayed", () => {
  it("is the finished round the feed keeps", () => {
    expect(replayableRound(view(round("resting"), finished()))?.roundId).toBe("r-1");
  });

  it("is never the live round, whatever that round happens to carry", () => {
    // The projection strips a live round's outcome, but the rule here does
    // not depend on that: a replay only ever looks at the finished round, so
    // a live one carrying its whole outcome still yields nothing to replay.
    const live = round("fight", {
      fight: { seed: "leak", durationMs: FIGHT_MS, characters: [], log: [{ t: 1 }], placements: ["agent-flint"], names: {} },
      result: { winner: "agent-flint" },
    });
    expect(replayableRound(view(live, null))).toBeNull();
  });

  it("is nothing while the pit has never finished a round", () => {
    expect(replayableRound(view(round("deciding"), null))).toBeNull();
    expect(replayableRound(null)).toBeNull();
  });

  it("is nothing for a recorded round with no fight or no result to show", () => {
    expect(replayableRound(view(null, round("result", { result: { winner: "x" } })))).toBeNull();
    expect(replayableRound(view(null, finished({ fight: { seed: "s", durationMs: 0, characters: [], log: [], placements: [], names: {} } })))).toBeNull();
    const noResult: ArenaFeedRound = { ...finished(), result: undefined };
    expect(replayableRound(view(null, noResult))).toBeNull();
  });
});

describe("playing it back", () => {
  const T0 = 1_000_000;
  const phaseAt = (ms: number): string | null => replayFrame(finished(), T0, T0 + ms)?.phase ?? null;

  it("walks the round in the order it happened", () => {
    expect(phaseAt(0)).toBe("deciding");
    expect(phaseAt(REPLAY_LINEUP_MS - 1)).toBe("deciding");
    expect(phaseAt(REPLAY_LINEUP_MS)).toBe("settling");
    expect(phaseAt(REPLAY_LINEUP_MS + REPLAY_BUYIN_MS)).toBe("reels");
    expect(phaseAt(REPLAY_LINEUP_MS + REPLAY_BUYIN_MS + REPLAY_REELS_MS)).toBe("fight");
    expect(phaseAt(REPLAY_LINEUP_MS + REPLAY_BUYIN_MS + REPLAY_REELS_MS + FIGHT_MS)).toBe("result");
  });

  it("ends, rather than looping or holding on the figures", () => {
    expect(replayFrame(finished(), T0, T0 + replayDurationMs(finished()))).toBeNull();
    expect(replayFrame(finished(), T0, T0 + 10 * 60_000)).toBeNull();
  });

  it("stamps the phase with this replay's own clock, so the fight starts where it should", () => {
    const intoFight = REPLAY_LINEUP_MS + REPLAY_BUYIN_MS + REPLAY_REELS_MS + 3_000;
    const frame = replayFrame(finished(), T0, T0 + intoFight)!;
    expect(frame.phase).toBe("fight");
    // The same helper the live fight uses, on a replay's marks.
    expect(fightOffsetMs(frame, T0 + intoFight)).toBe(3_000);
  });

  it("keeps everything else about the round, because that is what is being shown", () => {
    const frame = replayFrame(finished(), T0, T0 + 1_000)!;
    expect(frame.roundId).toBe("r-1");
    expect(frame.decisions[0]?.source).toBe("serv");
    expect(frame.result?.winner).toBe("agent-atlas");
  });

  it("has not started before it starts", () => {
    expect(replayFrame(finished(), T0, T0 - 1)).toBeNull();
  });
});
