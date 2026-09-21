import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LOCK_STALE_MS, resetSettleQueue, SettleInProgress, withSettleLock } from "./settleLock";

let dir: string;
afterEach(() => {
  resetSettleQueue();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const lock = (): string => {
  dir = mkdtempSync(join(tmpdir(), "servpit-lock-"));
  return join(dir, "settle.lock");
};

const settled = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("one settle at a time", () => {
  it("runs a settle and releases the lock after it", async () => {
    const file = lock();
    await withSettleLock(file, async () => "done");
    expect(existsSync(file)).toBe(false);
  });

  it("releases the lock when the settle throws", async () => {
    const file = lock();
    await expect(withSettleLock(file, async () => Promise.reject(new Error("chain said no")))).rejects.toThrow("chain said no");
    expect(existsSync(file)).toBe(false);
  });

  it("holds the second caller until the first is finished, rather than interleaving", async () => {
    const file = lock();
    const order: string[] = [];
    const first = settled<void>();

    const one = withSettleLock(file, async () => {
      order.push("one in");
      await first.promise;
      order.push("one out");
    });
    const two = withSettleLock(file, async () => {
      order.push("two in");
    });

    // Long enough for a queue that was not there to have let the second in.
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["one in"]);

    first.resolve();
    await Promise.all([one, two]);
    expect(order).toEqual(["one in", "one out", "two in"]);
  });

  it("still runs the next settle after one throws", async () => {
    const file = lock();
    const failed = withSettleLock(file, async () => Promise.reject(new Error("first")));
    const after = withSettleLock(file, async () => "second");
    await expect(failed).rejects.toThrow("first");
    await expect(after).resolves.toBe("second");
  });

  it("refuses a caller from another process with a sentence a player can read", async () => {
    const file = lock();
    writeFileSync(file, JSON.stringify({ pid: process.pid + 1, at: Date.now() }));
    await expect(withSettleLock(file, async () => "never")).rejects.toThrow(SettleInProgress);
    await expect(withSettleLock(file, async () => "never")).rejects.toThrow(/settling right now/i);
    // Somebody else's lock, so it is still there.
    expect(existsSync(file)).toBe(true);
  });

  it("takes over a lock whose holder died, so a crash does not close the pit", async () => {
    const file = lock();
    writeFileSync(file, JSON.stringify({ pid: process.pid + 1, at: Date.now() - LOCK_STALE_MS - 1 }));
    await expect(withSettleLock(file, async () => "taken")).resolves.toBe("taken");
    expect(existsSync(file)).toBe(false);
  });

  it("writes who holds it, so an operator can tell what is settling", async () => {
    const file = lock();
    const held = settled<void>();
    const run = withSettleLock(file, async () => {
      expect(JSON.parse(readFileSync(file, "utf8")).pid).toBe(process.pid);
      await held.promise;
    });
    held.resolve();
    await run;
  });
});
