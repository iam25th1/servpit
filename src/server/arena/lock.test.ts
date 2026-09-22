import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ARENA_LOCK_STALE_MS, ArenaAlreadyRunning, arenaLockFile, holdArenaLock } from "./lock";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const file = (): string => {
  dir = mkdtempSync(join(tmpdir(), "servpit-arena-lock-"));
  return join(dir, "arena.lock");
};

/** Higher than any pid this machine hands out, so nothing answers for it. */
const DEAD_PID = 4_194_305;

describe("one worker at a time", () => {
  it("takes the lock and writes who holds it", () => {
    const path = file();
    const lock = holdArenaLock(path);
    expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(process.pid);
    lock.release();
    expect(existsSync(path)).toBe(false);
  });

  it("refuses a second worker while the first is alive", () => {
    const path = file();
    // A pid that is definitely running: this one.
    writeFileSync(path, JSON.stringify({ pid: process.pid, at: Date.now() }));
    expect(() => holdArenaLock(path)).toThrow(ArenaAlreadyRunning);
    expect(() => holdArenaLock(path)).toThrow(/already running/);
    // Somebody else's lock, so it is still there.
    expect(existsSync(path)).toBe(true);
  });

  it("takes over a lock whose worker died, rather than leaving the pit dark", () => {
    const path = file();
    writeFileSync(path, JSON.stringify({ pid: DEAD_PID, at: Date.now() - ARENA_LOCK_STALE_MS - 1 }));
    const lock = holdArenaLock(path);
    expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(process.pid);
    lock.release();
  });

  it("takes over at once when the holder is gone, however fresh the lock looks", () => {
    // A worker that was killed leaves a lock stamped a second ago. Waiting
    // out the staleness window before its own restart may take the lock is
    // half an hour of a pit that is not running, and a supervised process is
    // restarted in seconds.
    const path = file();
    writeFileSync(path, JSON.stringify({ pid: DEAD_PID, at: Date.now() }));
    const lock = holdArenaLock(path);
    expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(process.pid);
    lock.release();
  });

  it("stays fresh while the worker is between rounds", () => {
    const path = file();
    let now = 1_000;
    const lock = holdArenaLock(path, () => now);
    now += ARENA_LOCK_STALE_MS * 2;
    lock.beat();
    // A second worker starting now sees a heartbeat from a moment ago, not a
    // lock from before the last long interval.
    expect(() => holdArenaLock(path, () => now + 1)).toThrow(ArenaAlreadyRunning);
    lock.release();
  });

  it("leaves a lock alone once somebody else has taken it over", () => {
    const path = file();
    const lock = holdArenaLock(path);
    writeFileSync(path, JSON.stringify({ pid: process.pid + 1, at: Date.now() }));
    lock.release();
    expect(existsSync(path)).toBe(true);
  });

  it("names the file per network, so two chains are two pits", () => {
    expect(arenaLockFile("data", "fake")).toBe(join("data", "arena-fake.lock"));
    expect(arenaLockFile("data", "base-sepolia")).toBe(join("data", "arena-base-sepolia.lock"));
  });
});
