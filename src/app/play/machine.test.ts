import { describe, expect, it } from "vitest";
import { GAME_MODES } from "@/config/modes";
import { initialState, reduce, type FlowState } from "./machine";

const plan = { roundId: "r-1", decisions: [{ agentId: "atlas" }] } as never;
const run = { roundId: "r-1", winner: "agent-atlas", replay: { log: [{}], characters: [], placements: ["agent-atlas"] } } as never;

const booted = (): FlowState => reduce(initialState(), { type: "assetsReady" });
const connected = (): FlowState => reduce(booted(), { type: "connected", player: { id: "p1", label: "0xabc" } });
const chosen = (): FlowState => reduce(connected(), { type: "modeChosen", modeId: "battleRoyale", stake: "low" });
const lobby = (): FlowState => reduce(chosen(), { type: "planLoaded", plan });
const pulled = (): FlowState => reduce(lobby(), { type: "leverPulled" });

describe("flow start", () => {
  it("opens on boot with nothing chosen", () => {
    const s = initialState();
    expect(s.screen).toBe("boot");
    expect(s.player).toBeNull();
    expect(s.leverLive).toBe(false);
  });

  it("holds on boot until the assets are actually ready", () => {
    const s = initialState();
    expect(reduce(s, { type: "connected", player: { id: "p", label: "x" } }).screen).toBe("boot");
    expect(booted().screen).toBe("title");
  });

  it("only leaves the title when the player asks", () => {
    expect(reduce(booted(), { type: "leverPulled" }).screen).toBe("title");
    expect(connected().screen).toBe("modeSelect");
  });

  it("moves to mode select once a player is connected", () => {
    const s = connected();
    expect(s.screen).toBe("modeSelect");
    expect(s.player?.label).toBe("0xabc");
  });

  it("refuses a locked mode and stays put", () => {
    const locked = GAME_MODES.find((m) => m.locked)!;
    const s = reduce(connected(), { type: "modeChosen", modeId: locked.id, stake: "low" });
    expect(s.screen).toBe("modeSelect");
    expect(s.mode).toBeNull();
    expect(s.error).toMatch(/not open yet/i);
  });

  it("refuses an unknown mode or an unknown stake", () => {
    expect(reduce(connected(), { type: "modeChosen", modeId: "nope", stake: "low" }).screen).toBe("modeSelect");
    expect(reduce(connected(), { type: "modeChosen", modeId: "battleRoyale", stake: "vip" as "low" }).mode).toBeNull();
  });

  it("accepts Battle Royale at either stake tier", () => {
    for (const stake of ["low", "high"] as const) {
      const s = reduce(connected(), { type: "modeChosen", modeId: "battleRoyale", stake });
      expect(s.screen).toBe("lobby");
      expect(s.mode?.id).toBe("battleRoyale");
      expect(s.stake).toBe(stake);
      expect(s.leverLive).toBe(false);
    }
  });
});

describe("lobby and lever", () => {
  it("keeps the lever dead until the agent decisions have landed", () => {
    expect(chosen().leverLive).toBe(false);
    const s = lobby();
    expect(s.screen).toBe("slot");
    expect(s.plan).not.toBeNull();
    expect(s.leverLive).toBe(true);
  });

  it("kills the lever the moment it is pulled, so a double click cannot double spin", () => {
    const s = pulled();
    expect(s.screen).toBe("spinning");
    expect(s.leverLive).toBe(false);
    const again = reduce(s, { type: "leverPulled" });
    expect(again).toBe(s);
  });

  it("ignores a lever pull before the decisions arrive", () => {
    const s = reduce(chosen(), { type: "leverPulled" });
    expect(s.screen).toBe("lobby");
  });
});

describe("handoff to the arena", () => {
  it("waits for both the reels to settle and the round to arrive, in either order", () => {
    const reelsFirst = reduce(reduce(pulled(), { type: "reelsSettled" }), { type: "roundReady", run });
    expect(reelsFirst.screen).toBe("arena");
    const roundFirst = reduce(reduce(pulled(), { type: "roundReady", run }), { type: "reelsSettled" });
    expect(roundFirst.screen).toBe("arena");
    expect(roundFirst.run).not.toBeNull();
  });

  it("stays on the slot while only one of the two has happened", () => {
    expect(reduce(pulled(), { type: "reelsSettled" }).screen).toBe("spinning");
    expect(reduce(pulled(), { type: "roundReady", run }).screen).toBe("spinning");
  });

  it("carries the round through to the result screen", () => {
    const arena = reduce(reduce(pulled(), { type: "reelsSettled" }), { type: "roundReady", run });
    const result = reduce(arena, { type: "playbackFinished" });
    expect(result.screen).toBe("result");
    expect(result.run).toBe(arena.run);
  });
});

describe("errors and replay", () => {
  it("surfaces a failure without losing the player or the mode", () => {
    const s = reduce(pulled(), { type: "failed", message: "round failed" });
    expect(s.screen).toBe("slot");
    expect(s.error).toBe("round failed");
    expect(s.player).not.toBeNull();
    expect(s.mode?.id).toBe("battleRoyale");
    expect(s.leverLive).toBe(true);
  });

  it("returns to mode select for another round, keeping the player connected", () => {
    const result = reduce(reduce(reduce(pulled(), { type: "reelsSettled" }), { type: "roundReady", run }), { type: "playbackFinished" });
    const again = reduce(result, { type: "playAgain" });
    expect(again.screen).toBe("modeSelect");
    expect(again.player).not.toBeNull();
    expect(again.run).toBeNull();
    expect(again.plan).toBeNull();
  });

  it("clears a stale error when the next mode is chosen", () => {
    const errored = reduce(connected(), { type: "modeChosen", modeId: "duel", stake: "low" });
    expect(errored.error).not.toBeNull();
    expect(reduce(errored, { type: "modeChosen", modeId: "battleRoyale", stake: "low" }).error).toBeNull();
  });

  it("ignores events that do not belong to the current screen", () => {
    const s = connected();
    expect(reduce(s, { type: "reelsSettled" })).toBe(s);
    expect(reduce(s, { type: "playbackFinished" })).toBe(s);
    expect(reduce(initialState(), { type: "modeChosen", modeId: "battleRoyale", stake: "low" }).screen).toBe("boot");
  });
});

describe("decisions arriving one at a time", () => {
  const inLobby = () => {
    let s = initialState();
    s = reduce(s, { type: "assetsReady" });
    s = reduce(s, { type: "connected", player: { id: "p", label: "Guest" } });
    return reduce(s, { type: "modeChosen", modeId: "battleRoyale", stake: "low" });
  };

  it("collects each decision as it lands, in arrival order", () => {
    let s = inLobby();
    expect(s.decided).toEqual([]);
    s = reduce(s, { type: "agentDecided", decision: { agentId: "delta" } });
    s = reduce(s, { type: "agentDecided", decision: { agentId: "atlas" } });
    expect(s.decided).toEqual([{ agentId: "delta" }, { agentId: "atlas" }]);
    // The lever stays dead until the whole plan is in.
    expect(s.leverLive).toBe(false);
    expect(s.screen).toBe("lobby");
  });

  it("ignores a decision that arrives after the plan has landed", () => {
    // A late line must not reopen a list the slot screen is already reading.
    let s = inLobby();
    s = reduce(s, { type: "agentDecided", decision: { agentId: "delta" } });
    s = reduce(s, { type: "planLoaded", plan: { roundId: "r-1" } });
    expect(s.screen).toBe("slot");
    const after = reduce(s, { type: "agentDecided", decision: { agentId: "late" } });
    expect(after).toBe(s);
  });

  it("clears the list when a round is chosen, whatever was left from the last one", () => {
    // Reducer level, because reaching mode select again means driving the
    // whole flow and the thing under test is the transition.
    const stale = { ...initialState(), screen: "modeSelect" as const, decided: [{ agentId: "delta" }] };
    const next = reduce(stale, { type: "modeChosen", modeId: "battleRoyale", stake: "low" });
    expect(next.screen).toBe("lobby");
    expect(next.decided).toEqual([]);
  });

  it("clears the list on the way back from a result", () => {
    const finished = { ...initialState(), screen: "result" as const, decided: [{ agentId: "delta" }] };
    const next = reduce(finished, { type: "playAgain" });
    expect(next.screen).toBe("modeSelect");
    expect(next.decided).toEqual([]);
  });
});
