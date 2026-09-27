// What the server does with a visitor's calls, decided from the pit rather than the post.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LeaderboardStore, leaderboardFile } from "../backing/leaderboard";
import type { ArenaPhase, ArenaRound, ArenaState } from "../arena/state";
import { RateLimiter } from "../backing/limit";
import { tokenHash } from "../backing/identity";
import { PickStore, pickFile } from "../backing/picks";
import { CALL_SEATS, callsOpen, callsView, submitCalls } from "./service";
import { settleReads } from "./settle";

let dir: string;
let store: PickStore;

const AT = "2026-09-22T00:00:00.000Z";
const TOKEN = "d0c7b1a2-3e4f-5a6b-7c8d-9e0f1a2b3c4d";
const OTHER_TOKEN = "11112222-3333-4444-5555-666677778888";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-calls-"));
  store = new PickStore(pickFile(dir, "fake"), "fake");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const round = (phase: ArenaPhase, extra: Partial<ArenaRound> = {}): ArenaRound => ({
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
  decisions: [],
  loans: [],
  refusals: [],
  bank: null,
  entries: [],
  ...extra,
});

const state = (phase: ArenaPhase | null, extra: Partial<ArenaRound> = {}): ArenaState => ({
  round: phase === null ? null : round(phase, extra),
  last: null,
  paused: false,
  nextRoundAt: null,
  updatedAt: AT,
});

const deps = (perMinute = 20) => ({ store, limiter: new RateLimiter(perMinute), arenaMode: true });

const call = (input: Partial<{ handle: unknown; token: unknown; calls: unknown }>, on: ArenaState = state("resting")) =>
  submitCalls(on, { handle: "ash", token: TOKEN, calls: { atlas: true, blaze: false }, ...input }, deps());

describe("when calls are taken", () => {
  it("takes them between rounds, on a new pit, and while a result is on screen", () => {
    for (const phase of [null, "resting", "failed", "result"] as const) expect(callsOpen(state(phase)), String(phase)).toBe(true);
  });

  it("locks them while any round is being decided or played", () => {
    for (const phase of ["planning", "deciding", "banking", "settling", "reels", "backing", "fight"] as const) {
      expect(callsOpen(state(phase)), phase).toBe(false);
      const answer = call({}, state(phase));
      expect(answer.ok, phase).toBe(false);
      if (!answer.ok) expect(answer.status).toBe(409);
    }
  });
});

describe("taking calls", () => {
  it("files them after the round on file, which is the round before the one they are about", () => {
    const answer = call({});
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.view.mine).toEqual({ atlas: true, blaze: false });
    expect(answer.view.callers).toBe(1);
    expect(store.callsOf("r-1", "ash")).toEqual({ atlas: true, blaze: false });
  });

  it("files them after nothing on a pit that has never played", () => {
    expect(call({}, state(null)).ok).toBe(true);
    expect(store.callsOf("", "ash")).toEqual({ atlas: true, blaze: false });
  });

  it("keeps the latest set when a visitor changes their mind", () => {
    call({});
    call({ calls: { atlas: false } });
    expect(callsView(state("resting"), store, "ash", TOKEN).mine).toEqual({ atlas: false });
  });

  it("tells a handle's calls only to the browser that owns it, so nobody can copy a read", () => {
    call({});
    expect(callsView(state("resting"), store, "ash", OTHER_TOKEN).mine).toBeNull();
    expect(callsView(state("resting"), store, "ash").mine).toBeNull();
    // How many have called is everybody's to see.
    expect(callsView(state("resting"), store, "ash").callers).toBe(1);
  });

  it("refuses a malformed request before it looks at the moment", () => {
    expect(call({ handle: "a" })).toMatchObject({ ok: false, status: 400 });
    expect(call({ token: "short" })).toMatchObject({ ok: false, status: 400 });
    expect(call({ calls: { bot: true } })).toMatchObject({ ok: false, status: 400 });
    expect(call({ calls: {} })).toMatchObject({ ok: false, status: 400 });
    // Malformed during a round is still malformed, not locked.
    expect(call({ calls: "atlas" }, state("deciding"))).toMatchObject({ ok: false, status: 400 });
  });

  it("covers every seat in the pit and nothing else", () => {
    expect(CALL_SEATS).toEqual(["atlas", "blaze", "comet", "delta", "ember", "flint"]);
  });

  it("refuses a handle another browser holds, here or in another log", () => {
    call({});
    expect(call({ token: OTHER_TOKEN })).toMatchObject({ ok: false, status: 409 });
    const owned = submitCalls(state("resting"), { handle: "bee", token: TOKEN, calls: { atlas: true } }, { ...deps(), otherOwner: () => tokenHash(OTHER_TOKEN) });
    expect(owned).toMatchObject({ ok: false, status: 409 });
  });

  it("limits how often one browser can change its calls", () => {
    const limited = { store, limiter: new RateLimiter(1), arenaMode: true };
    expect(submitCalls(state("resting"), { handle: "ash", token: TOKEN, calls: { atlas: true } }, limited).ok).toBe(true);
    expect(submitCalls(state("resting"), { handle: "ash", token: TOKEN, calls: { atlas: false } }, limited)).toMatchObject({ ok: false, status: 429 });
  });

  it("is for the live pit only", () => {
    expect(submitCalls(state("resting"), { handle: "ash", token: TOKEN, calls: { atlas: true } }, { ...deps(), arenaMode: false })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("the calls on a round being played", () => {
  it("are the ones filed after the round before it, made before it started", () => {
    call({});
    const live = state("deciding", { roundId: "r-2", after: "r-1", startedAt: "2099-01-01T00:00:00.000Z" });
    expect(callsView(live, store, "ash", TOKEN).round).toEqual({ roundId: "r-2", mine: { atlas: true, blaze: false } });
    // Nothing for the next round while this one is being decided.
    expect(callsView(live, store, "ash", TOKEN).mine).toBeNull();
    // And nothing at all to a browser that does not own the handle.
    expect(callsView(live, store, "ash", OTHER_TOKEN).round).toBeNull();
  });

  it("are nothing on a round stored before calls existed", () => {
    call({});
    expect(callsView(state("deciding", { roundId: "r-2" }), store, "ash", TOKEN).round).toBeNull();
  });
});

describe("scoring a round's reads", () => {
  it("scores each visitor against the round's final decisions, once", () => {
    call({ calls: { atlas: true, blaze: false } });
    submitCalls(state("resting"), { handle: "cyan", token: OTHER_TOKEN, calls: { atlas: false } }, deps());
    const decisions = [
      { agentId: "atlas", enter: true, source: "serv" },
      { agentId: "blaze", enter: false, source: "heuristic" },
    ];
    const round = { after: "r-1", roundId: "r-2", startedAt: Date.now() + 60_000, decisions };
    const settled = settleReads(dir, "fake", round);
    expect(settled.applied).toBe(true);
    expect(settled.scores.find((s) => s.handle === "ash")).toMatchObject({ called: 2, right: 2, points: 30 });
    expect(settled.scores.find((s) => s.handle === "cyan")).toMatchObject({ called: 1, right: 0, points: 0 });
    // A second settle of the same round changes nothing.
    expect(settleReads(dir, "fake", round).applied).toBe(false);
    expect(new LeaderboardStore(leaderboardFile(dir, "fake"), "fake").row("ash")).toMatchObject({ points: 30, reads: 2, readsRight: 2 });
  });

  it("never counts a call made after the round it is about had started", () => {
    call({ calls: { atlas: true } });
    const settled = settleReads(dir, "fake", { after: "r-1", roundId: "r-2", startedAt: Date.parse(AT), decisions: [{ agentId: "atlas", enter: true, source: "serv" }] });
    expect(settled.scores).toEqual([]);
  });
});
