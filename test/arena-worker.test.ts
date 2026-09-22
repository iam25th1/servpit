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
    // A lock held by a process that is not this one and is not stale.
    writeFileSync(join(data, "arena-fake.lock"), JSON.stringify({ pid: process.pid + 1, at: Date.now() }));
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
      SERVPIT_ARENA_MAX_ROUNDS: "1",
    });
    expect(run.code).toBe(0);
    const state = JSON.parse(readFileSync(join(data, "arena-fake.json"), "utf8"));
    const phases = state.round.phases.map((p: { phase: string }) => p.phase);
    expect(phases[0]).toBe("planning");
    expect(phases).toContain("deciding");
    expect(phases).toContain("settling");
    expect(phases).toContain("reels");
    expect(phases).toContain("fight");
    expect(phases).toContain("result");
    // The figures stand for a moment and then the pit is plainly waiting,
    // which is what a viewer sees for most of an interval.
    expect(phases[phases.length - 1]).toBe("resting");
    for (const mark of state.round.phases) expect(typeof mark.at).toBe("string");
    // The lock is released on the way out, so the next worker can start.
    expect(existsSync(join(data, "arena-fake.lock"))).toBe(false);
  }, 300_000);
});
