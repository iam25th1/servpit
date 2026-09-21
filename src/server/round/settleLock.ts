// One settle at a time.
//
// Nothing used to stop two. Two lever pulls in two tabs, or a script run
// beside the dev server, put two settles into the same debts, the same
// graveyard and the same rollover. Each one reads, decides and writes, so the
// second write is made from what the first one read: a debt cleared by one is
// resurrected by the other, a wreck is recorded twice, a rollover is spent
// twice. The idempotency keys on the transfers protect the money on the
// chain. They do nothing for the stores, because two different rounds have
// two different keys and both of them are valid.
//
// Two gates, because there are two ways it happens.
//
// In one process, a queue. A second settle waits for the first, which is what
// a player pulling the lever twice should see: the round settles, then the
// next one does.
//
// Between processes, a lock file. A second process is refused with a sentence
// the player can read rather than made to wait on something this process
// cannot see finish. A lock whose holder died is taken over after it goes
// stale, or a crash would close the pit until someone deleted a file.

import { readFileSync, rmSync, writeFileSync, openSync, closeSync, writeSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../log";

/** How long a lock file is believed. A settle is transfers and receipts, not minutes. */
export const LOCK_STALE_MS = 3 * 60 * 1000;

/** What a caller sees when another process is settling. */
export class SettleInProgress extends Error {
  readonly code = "settle_in_progress" as const;
  constructor(readonly heldByPid: number) {
    super("Another round is settling right now. Give it a moment and try again.");
    this.name = "SettleInProgress";
  }
}

interface Held {
  pid: number;
  at: number;
}

/** The in process queue. One promise chain per lock file. */
const queues = new Map<string, Promise<unknown>>();

function readHolder(file: string): Held | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Held>;
    if (typeof parsed.pid !== "number" || typeof parsed.at !== "number") return null;
    return { pid: parsed.pid, at: parsed.at };
  } catch {
    return null;
  }
}

/**
 * Takes the lock file, or throws when another live process holds it.
 *
 * Created with the exclusive flag, so two processes racing for it cannot both
 * succeed: the loser sees the file already there and decides what to do about
 * it from what is inside.
 */
function acquireFile(file: string, now: () => number): void {
  mkdirSync(dirname(file), { recursive: true });
  const body = JSON.stringify({ pid: process.pid, at: now() });
  try {
    const handle = openSync(file, "wx", 0o600);
    try {
      writeSync(handle, body);
    } finally {
      closeSync(handle);
    }
    return;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const holder = readHolder(file);
  const age = holder === null ? Infinity : now() - holder.at;
  if (holder !== null && holder.pid === process.pid) {
    // This process already holds it and the queue let this one through, which
    // means the previous holder in this process did not release. Refuse
    // rather than write over our own lock.
    throw new SettleInProgress(holder.pid);
  }
  if (age < LOCK_STALE_MS) throw new SettleInProgress(holder?.pid ?? 0);
  log.warn("taking over a stale settle lock", { file, heldByPid: holder?.pid ?? null, ageMs: Number.isFinite(age) ? age : null });
  writeFileSync(file, body, { mode: 0o600 });
}

function releaseFile(file: string): void {
  const holder = readHolder(file);
  // Only ours. A lock taken over by somebody else is not ours to delete.
  if (holder !== null && holder.pid !== process.pid) return;
  rmSync(file, { force: true });
}

/**
 * Runs fn with the settle lock held.
 *
 * Queued against other callers in this process, refused when another process
 * holds it. The lock is released whether fn returns or throws.
 */
export function withSettleLock<T>(file: string, fn: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const previous = queues.get(file) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      acquireFile(file, now);
      try {
        return await fn();
      } finally {
        releaseFile(file);
      }
    });
  // The queue holds the settled promise, not the caller's, so one settle
  // throwing does not reject the next one.
  queues.set(
    file,
    run.catch(() => undefined),
  );
  return run;
}

/** Test seam: forgets the in process queue. */
export function resetSettleQueue(): void {
  queues.clear();
}
