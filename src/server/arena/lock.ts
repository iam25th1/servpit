// One worker, held for as long as it runs.
//
// The settle lock in src/server/round/settleLock.ts guards a single round and
// is released the moment it ends. This guards the loop itself: two workers on
// one data directory would take turns writing the same arena file and paying
// for the same agents to decide twice. Same shape, different lifetime, so it
// is its own file rather than a flag on that one.

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { log } from "../log";

/**
 * How long a worker's lock is believed after its last heartbeat.
 *
 * A round can take minutes, and the worker writes the file again at the start
 * of every one, so anything much longer than an interval plus a round is a
 * worker that is gone.
 */
export const ARENA_LOCK_STALE_MS = 30 * 60 * 1000;

export class ArenaAlreadyRunning extends Error {
  readonly code = "arena_already_running" as const;
  constructor(readonly heldByPid: number) {
    super(`another arena worker is already running as process ${heldByPid}. Stop it before starting this one.`);
    this.name = "ArenaAlreadyRunning";
  }
}

interface Held {
  pid: number;
  at: number;
}

export function arenaLockFile(dataDir: string, network: string): string {
  return join(dataDir, `arena-${network}.lock`);
}

function readHolder(file: string): Held | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Held>;
    if (typeof parsed.pid !== "number" || typeof parsed.at !== "number") return null;
    return { pid: parsed.pid, at: parsed.at };
  } catch {
    return null;
  }
}

function writeHolder(file: string, now: () => number): void {
  writeFileSync(file, JSON.stringify({ pid: process.pid, at: now() }), { mode: 0o600 });
}

/**
 * Takes the worker lock, or throws when another live worker holds it.
 *
 * Returns a heartbeat to call at the top of each round and a release to call
 * on the way out. Without the heartbeat a worker on a long interval would
 * look stale to the next one to start.
 */
export function holdArenaLock(file: string, now: () => number = Date.now): { beat: () => void; release: () => void } {
  mkdirSync(dirname(file), { recursive: true });
  try {
    const handle = openSync(file, "wx", 0o600);
    try {
      writeSync(handle, JSON.stringify({ pid: process.pid, at: now() }));
    } finally {
      closeSync(handle);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const holder = readHolder(file);
    const age = holder === null ? Infinity : now() - holder.at;
    if (holder !== null && age < ARENA_LOCK_STALE_MS) throw new ArenaAlreadyRunning(holder.pid);
    log.warn("taking over a stale arena lock", { file, heldByPid: holder?.pid ?? null, ageMs: Number.isFinite(age) ? age : null });
    writeHolder(file, now);
  }

  return {
    beat: () => writeHolder(file, now),
    release: () => {
      const holder = readHolder(file);
      // Only ours. A lock taken over by somebody else is not ours to delete.
      if (holder !== null && holder.pid !== process.pid) return;
      rmSync(file, { force: true });
    },
  };
}
