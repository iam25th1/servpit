import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WreckStore, overReached, type WreckRecord } from "./wrecks";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const file = (): string => {
  dir = mkdtempSync(join(tmpdir(), "servpit-wrecks-"));
  return join(dir, "wrecks.json");
};

const record = (extra: Partial<WreckRecord> = {}): WreckRecord => ({
  roundId: "r-1",
  walletId: "flint",
  identityId: "flint-1",
  name: "Flint",
  trigger: "broke and denied credit",
  balanceAtDeathWei: "0",
  debtAtDeathWei: "0",
  principalAtDeathWei: "0",
  interestAtDeathWei: "0",
  seizedWei: "0",
  writtenOffWei: "0",
  peakBalanceWei: "0",
  borrowedWei: "0",
  loanCount: 0,
  recentStakeMultiples: [1],
  roundsSurvived: 1,
  wins: 0,
  at: "2026-09-21T00:00:00.000Z",
  ...extra,
});

describe("what ended an agent", () => {
  it("reads a record that borrowed as over-reaching", () => {
    expect(overReached(record({ borrowedWei: "10" }))).toBe(true);
    expect(overReached(record({ recentStakeMultiples: [1, 3] }))).toBe(true);
    expect(overReached(record())).toBe(false);
  });

  it("keeps one record per wallet per round", () => {
    const store = new WreckStore(file());
    store.save(record());
    store.save(record({ name: "Flint", wins: 2 }));
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0].wins).toBe(2);
    expect(store.has("r-1", "flint")).toBe(true);
    expect(store.countFor("flint")).toBe(1);
  });
});

describe("two readers of the same file", () => {
  // The graveyard is served from the server context and written from the
  // settle context, both in one process. A wall that only ever shows what was
  // on file when the process started is a wall that never grows.
  it("sees a wreck another store recorded", () => {
    const path = file();
    const writer = new WreckStore(path);
    const reader = new WreckStore(path);
    expect(reader.all()).toHaveLength(0);
    writer.save(record());
    expect(reader.all()).toHaveLength(1);
    expect(reader.countFor("flint")).toBe(1);
    expect(reader.has("r-1", "flint")).toBe(true);
  });

  it("does not lose its own records to a reread", () => {
    const path = file();
    const store = new WreckStore(path);
    store.save(record());
    store.save(record({ roundId: "r-2" }));
    expect(store.all()).toHaveLength(2);
  });
});
