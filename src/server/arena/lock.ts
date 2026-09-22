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
 * Only for a holder this machine cannot ask about. A pid that is gone is
 * taken over at once, because a worker that was killed should not keep its
 * own restart out for half an hour.
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

/**
 * Whether a process is still there, asked of the operating system.
 *
 * Signal 0 checks for the process without sending anything. It is only
 * meaningful for a pid on this machine, which is the case that matters: a
 * supervised worker that was killed leaves a lock file whose timestamp is
 * fresh, and without this its own restart would be refused for as long as the
 * staleness window, which is half an hour of a pit that is not running.
 *
 * A pid that has been reused answers yes and the restart is refused, which is
 * the safe direction to be wrong in.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM is a process that exists and belongs to somebody else.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
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
/**
 * When the worker last said it was alive, or null when no lock is held.
 *
 * The heartbeat rather than the round file, because the round file is quiet
 * between rounds by design and an hour of quiet is what a healthy pit on an
 * hourly interval looks like. Read only: the health endpoint may not take,
 * take over or touch the lock, and the pid inside it never leaves here.
 */
export function heartbeatAt(dataDir: string, network: string): number | null {
  return readHolder(arenaLockFile(dataDir, network))?.at ?? null;
}

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
    const held = holder !== null && alive(holder.pid);
    if (held && age < ARENA_LOCK_STALE_MS) throw new ArenaAlreadyRunning(holder.pid);
    log.warn("taking over an arena lock", { file, heldByPid: holder?.pid ?? null, ageMs: Number.isFinite(age) ? age : null, holderAlive: held });
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
