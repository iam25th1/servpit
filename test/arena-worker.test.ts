// The worker as an operator meets it: a process, started with an environment.
//
// Run as child processes rather than imported, because what is being checked
// is what the command does. Node directly rather than npx, so a kill reaches
// the writer rather than a shim.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const dataDir = (): string => {
  dir = mkdtempSync(join(tmpdir(), "servpit-arena-"));
  return dir;
};

interface Run {
  code: number | null;
  out: string;
}

function runWorker(env: Record<string, string>, killAfterMs?: number): Promise<Run> {
  const script = resolve(process.cwd(), "scripts/arena.ts");
  const child = spawn(process.execPath, ["--import", "tsx", script], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, SERV_API_KEY: "", ...env },
  });
  let out = "";
  child.stdout.on("data", (b) => (out += String(b)));
  child.stderr.on("data", (b) => (out += String(b)));
  if (killAfterMs !== undefined) setTimeout(() => child.kill("SIGTERM"), killAfterMs);
  return new Promise<Run>((done) => child.on("exit", (code) => done({ code, out })));
}

describe("the worker with arena mode off", () => {
  it("does nothing at all, and says so", async () => {
    const data = dataDir();
    const run = await runWorker({ SERVPIT_DATA_DIR: data, WALLET_BACKEND: "fake" });
    expect(run.code).toBe(0);
    expect(run.out).toMatch(/SERVPIT_ARENA_MODE is not true/);
    expect(run.out).toMatch(/The lever starts rounds/);
    // No lock, no arena file, no round: nothing was started and nothing was
    // written, so the lever's world is untouched.
    expect(existsSync(join(data, "arena-fake.lock"))).toBe(false);
    expect(existsSync(join(data, "arena-fake.json"))).toBe(false);
  }, 120_000);
});

describe("the worker with arena mode on", () => {
  it("refuses to start beside another worker", async () => {
    const data = dataDir();
    // A lock held by a process that is alive and is not stale. This one: the
    // worker starts as a child, so it can see this pid and will refuse. A pid
    // that is merely plausible is not enough any more, because a holder that
    // is gone is now taken over at once rather than waited out.
    writeFileSync(join(data, "arena-fake.lock"), JSON.stringify({ pid: process.pid, at: Date.now() }));
    const run = await runWorker({
      SERVPIT_DATA_DIR: data,
      WALLET_BACKEND: "fake",
      SERVPIT_ARENA_MODE: "true",
      SERVPIT_ROUND_INTERVAL_SECONDS: "5",
    });
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/another arena worker is already running/);
  }, 120_000);

  it("plays a round, records its phases in order, and stops when asked", async () => {
    const data = dataDir();
    const run = await runWorker({
      SERVPIT_DATA_DIR: data,
      WALLET_BACKEND: "fake",
      SERVPIT_ARENA_MODE: "true",
      SERVPIT_ROUND_INTERVAL_SECONDS: "5",
      // The shortest window the config allows, so the test is not held for
      // the forty five seconds a real pit gives its viewers.
      SERVPIT_BACKING_WINDOW_SECONDS: "5",
      SERVPIT_ARENA_MAX_ROUNDS: "1",
    });
    expect(run.code).toBe(0);
    const state = JSON.parse(readFileSync(join(data, "arena-fake.json"), "utf8"));
    const phases = state.round.phases.map((p: { phase: string }) => p.phase);
    expect(phases[0]).toBe("planning");
    expect(phases).toContain("deciding");
    expect(phases).toContain("settling");
    expect(phases).toContain("reels");
    // Picks happen between the draw and the fight, and the fight waits.
    expect(phases).toContain("backing");
    expect(phases.indexOf("backing")).toBeGreaterThan(phases.indexOf("reels"));
    expect(phases.indexOf("backing")).toBeLessThan(phases.indexOf("fight"));
    expect(phases).toContain("fight");
    expect(phases).toContain("result");
    // The figures stand for a moment and then the pit is plainly waiting,
    // which is what a viewer sees for most of an interval.
    expect(phases[phases.length - 1]).toBe("resting");
    for (const mark of state.round.phases) expect(typeof mark.at).toBe("string");
    // The lock is released on the way out, so the next worker can start.
    expect(existsSync(join(data, "arena-fake.lock"))).toBe(false);
  }, 300_000);

  it("seats a claimed fighter, fights it, and scores the calls made before the round", async () => {
    const data = dataDir();
    const at = new Date(Date.now() - 60_000).toISOString();
    // A claim and a set of calls, written the way the routes write them, a
    // minute before the worker starts.
    const lines = (rows: object[]): string => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
    writeFileSync(join(data, "fighters-fake.ndjson"), lines([{ k: "head", network: "fake" }, { k: "claim", handle: "cupcake", tokenHash: "h1", name: "cupcake", face: "Monk", at }]));
    const calls = { atlas: true, blaze: true, comet: true, delta: true, ember: true, flint: true };
    writeFileSync(join(data, "picks-fake.ndjson"), lines([{ k: "head", network: "fake" }, { k: "claim", handle: "reader", tokenHash: "h2", at }, { k: "call", after: "", handle: "reader", calls, at }]));

    const run = await runWorker({
      SERVPIT_DATA_DIR: data,
      WALLET_BACKEND: "fake",
      SERVPIT_ARENA_MODE: "true",
      SERVPIT_ROUND_INTERVAL_SECONDS: "5",
      SERVPIT_BACKING_WINDOW_SECONDS: "5",
      SERVPIT_ARENA_MAX_ROUNDS: "1",
    });
    expect(run.code).toBe(0);
    const state = JSON.parse(readFileSync(join(data, "arena-fake.json"), "utf8"));
    // Seated, published, and in the fight.
    expect(state.round.fighters).toEqual([{ handle: "cupcake", name: "cupcake", face: "Monk", entrantId: "fighter-cupcake" }]);
    expect(state.round.fight.placements).toContain("fighter-cupcake");
    // The calls were filed after nothing, because this pit had never played.
    expect(state.round.after).toBe("");
    // The seats the next round will find, one per wallet.
    expect(state.round.table).toHaveLength(6);
    for (const seat of state.round.table) expect(["won", "lost", "held", "new"]).toContain(seat.last);
    // The read is on the board, scored against what the agents did.
    const board = JSON.parse(readFileSync(join(data, "leaderboard-fake.json"), "utf8"));
    const reader = board.rows.find((row: { handle: string }) => row.handle === "reader");
    const entered = state.round.decisions.filter((d: { enter: boolean }) => d.enter).length;
    expect(reader).toMatchObject({ reads: 6, readsRight: entered });
    // And the fighter has a career.
    const careers = JSON.parse(readFileSync(join(data, "careers-fake.json"), "utf8"));
    expect(careers.rows.map((row: { handle: string }) => row.handle)).toContain("cupcake");
  }, 300_000);
});
