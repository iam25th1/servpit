// What the server does with a pick, decided from the pit rather than the post.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArenaPhase, ArenaRound, ArenaState } from "../arena/state";
import { RateLimiter } from "./limit";
import { tokenHash } from "./identity";
import { PickStore } from "./picks";
import { backingView, submitPick } from "./service";

let dir: string;
let store: PickStore;

const AT = "2026-09-22T00:00:00.000Z";
const T0 = Date.parse(AT);
const WINDOW_MS = 45_000;
const TOKEN = "d0c7b1a2-3e4f-5a6b-7c8d-9e0f1a2b3c4d";
const OTHER_TOKEN = "11112222-3333-4444-5555-666677778888";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-backing-"));
  store = new PickStore(join(dir, "picks-fake.ndjson"), "fake");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const round = (phase: ArenaPhase, extra: Partial<ArenaRound> = {}): ArenaRound => ({
  roundId: "r-1",
  startedAt: AT,
  phase,
  phases: [{ phase: "reels", at: AT }, { phase, at: AT, ...(phase === "backing" ? { durationMs: WINDOW_MS } : {}) }],
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
  entries: [
    { agentId: "atlas", amountWei: "10000000000000", txHash: null, link: null },
    { agentId: "vex", amountWei: "10000000000000", txHash: null, link: null },
  ],
  ...extra,
});

const state = (phase: ArenaPhase, extra: Partial<ArenaRound> = {}): ArenaState => ({
  round: round(phase, extra),
  last: null,
  paused: false,
  nextRoundAt: null,
  updatedAt: AT,
});

const deps = (now = T0, perMinute = 10) => ({ store, limiter: new RateLimiter(perMinute), arenaMode: true, now: () => now });

const pick = (input: Partial<{ handle: unknown; token: unknown; agentId: unknown }>, at = T0, on: ArenaState = state("backing")) =>
  submitPick(on, { handle: "ash", token: TOKEN, agentId: "atlas", ...input }, deps(at));

describe("taking a pick", () => {
  it("records it against the round the pit is playing", () => {
    const answer = pick({});
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.view.pick).toBe("atlas");
    expect(answer.view.counts).toEqual({ atlas: 1 });
    expect(store.pickOf("r-1", "ash")).toBe("atlas");
  });

  it("lets a viewer change their mind while the window is open", () => {
    pick({});
    const again = pick({ agentId: "vex" });
    expect(again.ok).toBe(true);
    expect(store.pickOf("r-1", "ash")).toBe("vex");
    expect(store.countsFor("r-1")).toEqual({ vex: 1 });
  });

  it("counts several viewers on several agents", () => {
    expect(pick({})).toMatchObject({ ok: true });
    expect(pick({ handle: "bowen", token: OTHER_TOKEN, agentId: "vex" })).toMatchObject({ ok: true });
    const view = backingView(state("backing"), store, "ash", () => T0);
    expect(view.counts).toEqual({ atlas: 1, vex: 1 });
    expect(view.backers).toBe(2);
    expect(view.open).toBe(true);
  });
});

describe("refusing a pick", () => {
  it("refuses one that arrives after the window closed, whatever the client sends", () => {
    const answer = pick({}, T0 + WINDOW_MS + 1);
    expect(answer).toMatchObject({ ok: false, status: 409 });
    expect(store.pickOf("r-1", "ash")).toBeNull();
  });

  it("refuses one in any other phase, including the fight", () => {
    for (const phase of ["reels", "fight", "result", "resting"] as ArenaPhase[]) {
      const answer = pick({}, T0, state(phase));
      expect(answer, phase).toMatchObject({ ok: false, status: 409 });
    }
  });

  it("refuses a handle somebody else's browser claimed", () => {
    pick({});
    const answer = pick({ token: OTHER_TOKEN, agentId: "vex" });
    expect(answer).toMatchObject({ ok: false, status: 409 });
    // The first browser's pick stands.
    expect(store.pickOf("r-1", "ash")).toBe("atlas");
  });

  it("refuses an agent that is not in the round", () => {
    expect(pick({ agentId: "flint" })).toMatchObject({ ok: false, status: 400 });
    expect(pick({ agentId: "bot-04" })).toMatchObject({ ok: false, status: 400 });
    expect(pick({ agentId: "" })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a handle that is not a name, and a browser with no token", () => {
    expect(pick({ handle: "<script>" })).toMatchObject({ ok: false, status: 400 });
    expect(pick({ handle: "ab" })).toMatchObject({ ok: false, status: 400 });
    expect(pick({ token: "short" })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses everything while the pit is not running rounds itself", () => {
    const answer = submitPick(state("backing"), { handle: "ash", token: TOKEN, agentId: "atlas" }, { ...deps(), arenaMode: false });
    expect(answer).toMatchObject({ ok: false, status: 403 });
  });

  it("stops one browser flooding the log", () => {
    const shared = { store, limiter: new RateLimiter(2), arenaMode: true, now: () => T0 };
    const once = () => submitPick(state("backing"), { handle: "ash", token: TOKEN, agentId: "atlas" }, shared);
    expect(once().ok).toBe(true);
    expect(once().ok).toBe(true);
    expect(once()).toMatchObject({ ok: false, status: 429 });
  });

  it("says nothing about the round it is refusing, beyond the refusal", () => {
    const answer = pick({}, T0 + WINDOW_MS + 1);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.message).toMatch(/^[A-Z][a-z ]/);
    expect(answer.message).not.toMatch(/seed|placement|winner|log/i);
  });
});

describe("what a viewer is told between picks", () => {
  it("says the window is shut once the clock passes it, even before the phase moves on", () => {
    expect(backingView(state("backing"), store, null, () => T0 + WINDOW_MS + 1).open).toBe(false);
  });

  it("carries no pick for a viewer who has not made one", () => {
    expect(backingView(state("backing"), store, "nobody", () => T0).pick).toBeNull();
  });

  it("carries the counts after the window, so the result can say what the field did", () => {
    pick({});
    const after = backingView(state("result"), store, "ash", () => T0 + 60_000);
    expect(after.open).toBe(false);
    expect(after.counts).toEqual({ atlas: 1 });
    expect(after.pick).toBe("atlas");
  });
});

describe("one handle, one browser, across both logs", () => {
  it("refuses a pick under a handle claimed by pulling the lever", () => {
    // The two logs each kept their own claims and each checked only its own,
    // so a name claimed at the lever could still be picked under here.
    const answer = submitPick(
      state("backing"),
      { handle: "ash", token: TOKEN, agentId: "atlas" },
      { ...deps(), otherOwner: () => "another-browsers-hash" },
    );
    expect(answer).toMatchObject({ ok: false, status: 409 });
    if (!answer.ok) expect(answer.message).toMatch(/another browser/);
  });

  it("lets the browser that made that claim pick under it", () => {
    const answer = submitPick(
      state("backing"),
      { handle: "ash", token: TOKEN, agentId: "atlas" },
      { ...deps(), otherOwner: () => tokenHash(TOKEN) },
    );
    expect(answer.ok).toBe(true);
  });
});
