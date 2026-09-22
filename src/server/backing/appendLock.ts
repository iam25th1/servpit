// A lock held for the length of one append.
//
// O_APPEND puts every write at the end of the file, but it does not promise
// that one write lands whole: a partial write leaves the rest of the line to
// be written after somebody else's, and a reader finds two half lines. This
// was not theoretical. Six processes appending picks produced a torn line on
// the first run of the concurrency test next to it.
//
// So the append itself is taken under an exclusive file, created with wx so
// two processes racing for it cannot both win. It is held for microseconds,
// which is why a waiter spins rather than being refused the way a settle is:
// a settle is transfers and receipts, an append is one line.
//
// A lock whose holder died is taken over once it goes stale. Without that a
// crash in the wrong microsecond would close the backing window until
// somebody deleted a file.

import { closeSync, mkdirSync, openSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/** How long a lock is believed. One append, not one round. */
export const APPEND_LOCK_STALE_MS = 2_000;
/**
 * How long a waiter keeps trying before giving up on the write.
 *
 * The hold itself is microseconds, so this only matters when the machine is
 * saturated: six writers on a busy box took longer than two seconds to take
 * turns once, and a refused pick is a worse answer than a slow one. Still
 * short enough that a request cannot sit on it.
 */
export const APPEND_LOCK_WAIT_MS = 5_000;

/** What a caller sees when the log could not be written at all. */
export class PickLogBusy extends Error {
  readonly code = "pick_log_busy" as const;
  constructor() {
    super("The pit is busy. Try that again.");
    this.name = "PickLogBusy";
  }
}

/** Sleeps without yielding to the event loop, because the caller is sync. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function take(file: string): boolean {
  try {
    const handle = openSync(file, "wx", 0o600);
    try {
      writeSync(handle, String(process.pid));
    } finally {
      closeSync(handle);
    }
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const stat = statSync(file, { throwIfNoEntry: false });
    // A lock older than one append could ever take belongs to a process that
    // is not coming back.
    if (stat && Date.now() - stat.mtimeMs > APPEND_LOCK_STALE_MS) rmSync(file, { force: true });
    return false;
  }
}

/** Runs fn with the lock held, or throws PickLogBusy having written nothing. */
export function withAppendLock<T>(target: string, fn: () => T): T {
  const file = `${target}.lock`;
  mkdirSync(dirname(file), { recursive: true });
  const until = Date.now() + APPEND_LOCK_WAIT_MS;
  while (!take(file)) {
    if (Date.now() >= until) throw new PickLogBusy();
    pause(2);
  }
  try {
    return fn();
  } finally {
    rmSync(file, { force: true });
  }
}
