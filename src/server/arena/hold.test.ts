// The worker holding itself for money, and letting go once it is there.
//
// Driven on a clock of its own, so ten minute waits take no time. The round
// is injected, because what is checked here is whether one starts at all,
// what the pit says while it does not, and how often it looks and logs.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stakeWeiFrom } from "@/config/stake";
import type { ServerContext } from "../context";
import { log } from "../log";
import { bankNeedsWei, operatorNeedsWei } from "./funding";
import { ArenaStore, type ArenaRound } from "./state";
import { HOLD_BEAT_MS, runArenaLoop } from "./worker";

let dir: string;
type Spy = { mock: { calls: unknown[][] } };
let warn: Spy;
let info: Spy;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-hold-"));
  warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
  info = vi.spyOn(log, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const RESERVE = stakeWeiFrom() * 2n;
const INTERVAL = 180_000;
const CHECK = 600_000;
const BANK_OK = bankNeedsWei(stakeWeiFrom(), RESERVE);
const OPERATOR_OK = operatorNeedsWei(stakeWeiFrom(), RESERVE);

/** Wallets whose balances a test can change between looks. */
function wallets(start: { bank: bigint; operator: bigint; pot?: bigint }) {
  const balances: Record<string, bigint> = { pot: start.pot ?? stakeWeiFrom() * 100n, bank: start.bank, operator: start.operator };
  const ctx = {
    chain: { gasReserveWei: RESERVE },
    wallets: { pot: { id: "pot" }, bank: { id: "bank" }, operator: { id: "operator" } },
    bankroll: { get: async (wallet: { id: string }) => balances[wallet.id] ?? 0n },
    flow: { rollover: { carriedWei: 0n }, wreckStore: { countSince: () => 0 } },
  } as unknown as ServerContext;
  return { ctx, balances };
}

/** A clock that moves only when the loop sleeps. */
function clock() {
  let t = Date.parse("2026-11-09T18:00:00.000Z");
  return { now: () => t, sleep: async (ms: number) => void (t += ms), advance: (ms: number) => void (t += ms) };
}

const finished: ArenaRound = {
  roundId: "r-last",
  startedAt: "2026-11-09T17:50:00.000Z",
  phase: "resting",
  phases: [
    { phase: "planning", at: "2026-11-09T17:50:00.000Z" },
    { phase: "result", at: "2026-11-09T17:52:00.000Z" },
    { phase: "resting", at: "2026-11-09T17:52:12.000Z" },
  ],
  network: "fake",
  backend: "fake",
  entrants: 24,
  bots: 18,
  stakeChips: 10,
  weiPerChip: "1",
  decisions: [],
  loans: [],
  refusals: [],
  bank: null,
  entries: [],
  result: { winner: "agent-atlas" } as unknown as ArenaRound["result"],
};

function arena(): ArenaStore {
  const store = new ArenaStore(join(dir, "arena.json"), "fake");
  store.write({ round: finished, last: finished, paused: false, nextRoundAt: null });
  return store;
}

const lines = (spy: Spy, message: string): number => spy.mock.calls.filter((c) => c[0] === message).length;

describe("a pit that cannot fund a round", () => {
  it("pauses on an empty bank: no round, and says so in the state", async () => {
    const { ctx } = wallets({ bank: 0n, operator: OPERATOR_OK });
    const store = arena();
    const c = clock();
    let played = 0;
    const counts = await runArenaLoop({ ctx, store, pauseFile: join(dir, "nope"), intervalMs: INTERVAL, fundsCheckMs: CHECK, maxRounds: 1, now: c.now, sleep: c.sleep, play: async () => void (played += 1) });

    expect(played).toBe(0);
    expect(counts).toEqual({ played: 0, failed: 0, rested: 1 });
    const state = store.read();
    expect(state.hold).toMatchObject({ kind: "funds", reason: expect.stringMatching(/the bank is out of funds/) });
    expect(state.funds?.bank?.ok).toBe(false);
    // The operator's own pause is a different thing, and is not set.
    expect(state.paused).toBe(false);
    expect(state.nextRoundAt).toBeNull();
  });

  it("pauses on an empty operator, because a retirement could not be refilled", async () => {
    const { ctx } = wallets({ bank: BANK_OK, operator: 0n });
    const store = arena();
    const c = clock();
    let played = 0;
    await runArenaLoop({ ctx, store, pauseFile: join(dir, "nope"), intervalMs: INTERVAL, fundsCheckMs: CHECK, maxRounds: 1, now: c.now, sleep: c.sleep, play: async () => void (played += 1) });

    expect(played).toBe(0);
    expect(store.read().hold?.reason).toMatch(/the operator is out of funds/);
    expect(store.read().funds?.operator?.ok).toBe(false);
  });

  it("shows the last finished round, not whatever the interval left behind", async () => {
    const { ctx } = wallets({ bank: 0n, operator: 0n });
    const store = arena();
    // What a broke pit used to leave on file: a round of nothing but
    // retirements, which is what a viewer was shown.
    store.write({ round: { ...finished, roundId: "r-churn", phase: "failed", phases: [{ phase: "failed", at: "2026-11-09T17:59:00.000Z", reason: "x" }] }, last: finished, paused: false, nextRoundAt: null });
    const c = clock();
    await runArenaLoop({ ctx, store, pauseFile: join(dir, "nope"), intervalMs: INTERVAL, fundsCheckMs: CHECK, maxRounds: 1, now: c.now, sleep: c.sleep, play: async () => undefined });

    const state = store.read();
    expect(state.round?.roundId).toBe("r-last");
    expect(state.round?.phase).toBe("resting");
    expect(state.round?.phases.at(-1)?.reason).toBe(state.hold?.reason);
    expect(state.last?.roundId).toBe("r-last");
  });

  it("looks again on the slow interval, logs once, and writes one resting mark however long it waits", async () => {
    const { ctx } = wallets({ bank: 0n, operator: 0n });
    const store = arena();
    const c = clock();
    const looks: number[] = [];
    const beats: number[] = [];
    let left = 4;
    await runArenaLoop({
      ctx,
      store,
      pauseFile: join(dir, "nope"),
      intervalMs: INTERVAL,
      fundsCheckMs: CHECK,
      now: c.now,
      sleep: c.sleep,
      running: () => left > 0,
      beat: () => beats.push(c.now()),
      // A pull waiting the whole time. It must not cut a hold short.
      pulls: { pending: () => ({ id: "p1", handle: "ash" }), take: () => undefined, start: () => undefined },
      checkFunds: async (cx, at) => {
        looks.push(at);
        left -= 1;
        const { fundingCheck } = await import("./funding");
        return fundingCheck(cx, at);
      },
      play: async () => {
        throw new Error("a held pit must not play");
      },
    });

    expect(looks).toHaveLength(4);
    for (let i = 1; i < looks.length; i++) expect(looks[i] - looks[i - 1]).toBe(CHECK);
    expect(lines(warn, "arena paused: out of funds")).toBe(1);
    expect(lines(warn, "arena resting on funds")).toBe(0);
    expect(lines(info, "arena treasury")).toBe(0);
    // One mark, when the hold began, rather than one per look.
    expect(store.read().round?.phases.filter((p) => p.phase === "resting" && p.reason)).toHaveLength(1);
    // Still alive as far as health is concerned, all the way through.
    for (let i = 1; i < beats.length; i++) expect(beats[i] - beats[i - 1]).toBeLessThanOrEqual(HOLD_BEAT_MS + 1_000);
    expect(store.read().hold?.nextCheckAt).toBe(new Date(looks.at(-1)! + CHECK).toISOString());
  });
});

describe("a pit that gets its money back", () => {
  it("resumes on its own at the next look, and says so once", async () => {
    const { ctx, balances } = wallets({ bank: 0n, operator: 0n });
    const store = arena();
    const c = clock();
    let looks = 0;
    let played = 0;
    await runArenaLoop({
      ctx,
      store,
      pauseFile: join(dir, "nope"),
      intervalMs: INTERVAL,
      fundsCheckMs: CHECK,
      maxRounds: 4,
      now: c.now,
      sleep: c.sleep,
      checkFunds: async (cx, at) => {
        looks += 1;
        // Somebody tops both wallets up between the second and third look.
        if (looks === 3) {
          balances.bank = BANK_OK * 10n;
          balances.operator = OPERATOR_OK * 10n;
        }
        const { fundingCheck } = await import("./funding");
        return fundingCheck(cx, at);
      },
      play: async () => {
        played += 1;
        expect(store.read().hold).toBeNull();
        return "played";
      },
    });

    expect(played).toBe(2);
    expect(store.read().hold).toBeNull();
    expect(store.read().funds?.ok).toBe(true);
    expect(lines(warn, "arena paused: out of funds")).toBe(1);
    expect(lines(info, "arena resumed")).toBe(1);
  });
});
