// The graveyard on disk: appended a line at a time, set aside and compressed
// by size or by day, and read whole across every file it is in.

import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { graveyardOptions } from "@/config/graveyard";
import { StoreNetworkMismatch } from "../store/file";
import { loadStores } from "../stats/read";
import { appendWreck, graveyardPaths, listArchives, readGraveyard, rotateGraveyard } from "./graveyard";
import { WreckStore, type WreckRecord } from "./wrecks";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-graveyard-"));
});
afterEach(() => {
  delete process.env.SERVPIT_GRAVEYARD_ROTATE_MB;
  delete process.env.SERVPIT_GRAVEYARD_KEEP;
  rmSync(dir, { recursive: true, force: true });
});

const DAY1 = Date.parse("2026-11-09T10:00:00.000Z");
const DAY2 = Date.parse("2026-11-10T10:00:00.000Z");
const BIG = { maxBytes: 1024 * 1024 * 1024, keep: 60 };

function wreck(n: number, extra: Partial<WreckRecord> = {}): WreckRecord {
  return {
    roundId: `r-${n}`,
    walletId: ["atlas", "blaze", "comet", "delta", "ember", "flint"][n % 6],
    identityId: `x-${n}`,
    name: `Agent ${n}`,
    face: null,
    trigger: "debt above the ceiling",
    balanceAtDeathWei: "1",
    debtAtDeathWei: "50",
    principalAtDeathWei: "40",
    interestAtDeathWei: "10",
    seizedWei: "1",
    writtenOffWei: "49",
    peakBalanceWei: "100",
    borrowedWei: "40",
    loanCount: 2,
    recentStakeMultiples: [1, 2],
    roundsSurvived: 9,
    wins: 1,
    at: new Date(DAY1 + n * 1000).toISOString(),
    ...extra,
  };
}

const file = (): string => join(dir, "wrecks-fake.json");
const paths = () => graveyardPaths(file());
const names = (): string[] => readdirSync(dir).filter((f) => f.startsWith("wrecks-fake")).sort();

describe("appending", () => {
  it("writes one line per retirement after a stamped head, and never rewrites what is there", () => {
    const p = paths();
    appendWreck(p, "fake", wreck(1), BIG, DAY1);
    const first = readFileSync(p.active, "utf8");
    const inode = statSync(p.active).ino;
    appendWreck(p, "fake", wreck(2), BIG, DAY1);
    const second = readFileSync(p.active, "utf8");

    expect(second.startsWith(first)).toBe(true);
    expect(statSync(p.active).ino).toBe(inode);
    const lines = second.trim().split("\n").map((l) => JSON.parse(l) as { k: string; network?: string; roundId?: string });
    expect(lines.map((l) => l.k)).toEqual(["head", "wreck", "wreck"]);
    expect(lines[0].network).toBe("fake");
    expect(lines.slice(1).map((l) => l.roundId)).toEqual(["r-1", "r-2"]);
    // The old single file is never created by a write.
    expect(existsSync(p.legacy)).toBe(false);
  });

  it("ends a line a crash cut short, so the next one starts clean", () => {
    const p = paths();
    appendWreck(p, "fake", wreck(1), BIG, DAY1);
    appendFileSync(p.active, '{"k":"wreck","roundId":"r-half');
    appendWreck(p, "fake", wreck(2), BIG, DAY1);
    expect(readGraveyard(file(), "fake")?.map((w) => w.roundId)).toEqual(["r-1", "r-2"]);
  });

  it("refuses to append to another network's file", () => {
    const p = paths();
    appendWreck(p, "base-sepolia", wreck(1), BIG, DAY1);
    expect(() => appendWreck(p, "fake", wreck(2), BIG, DAY1)).toThrow(StoreNetworkMismatch);
  });
});

describe("rotation", () => {
  it("sets the file aside by size, compressed with zlib, and starts a new one", () => {
    const p = paths();
    const small = { maxBytes: 1500, keep: 60 };
    for (let n = 0; n < 12; n++) appendWreck(p, "fake", wreck(n), small, DAY1 + n);
    const archives = listArchives(p);
    expect(archives.length).toBeGreaterThan(1);
    for (const a of archives) {
      expect(a.compressed).toBe(true);
      expect(a.file.endsWith(".ndjson.gz")).toBe(true);
      // Plain gzip: anything can read it, not only this code.
      expect(gunzipSync(readFileSync(a.file)).toString("utf8").split("\n")[0]).toMatch(/"k":"head"/);
    }
    expect(statSync(p.active).size).toBeLessThan(small.maxBytes + 1000);
    expect(readGraveyard(file(), "fake")?.map((w) => w.roundId)).toEqual(Array.from({ length: 12 }, (_, n) => `r-${n}`));
  });

  it("sets the file aside when the day turns, by UTC", () => {
    const p = paths();
    appendWreck(p, "fake", wreck(1), BIG, DAY1);
    appendWreck(p, "fake", wreck(2), BIG, DAY1 + 60_000);
    expect(listArchives(p)).toHaveLength(0);
    appendWreck(p, "fake", wreck(3), BIG, DAY2);
    const archives = listArchives(p);
    expect(archives).toHaveLength(1);
    expect(archives[0].stamp).toBe("20261109T100000000Z");
    expect(readFileSync(p.active, "utf8")).toMatch(/"startedAt":"2026-11-10T10:00:00.000Z"/);
    expect(readGraveyard(file(), "fake")?.map((w) => w.roundId)).toEqual(["r-1", "r-2", "r-3"]);
  });

  it("does not set aside a file that holds nothing but its head", () => {
    const p = paths();
    writeFileSync(p.active, `${JSON.stringify({ k: "head", network: "fake", startedAt: new Date(DAY1).toISOString() })}\n`);
    appendWreck(p, "fake", wreck(1), BIG, DAY2);
    expect(listArchives(p)).toHaveLength(0);
  });

  it("keeps the newest files it is told to and removes the oldest", () => {
    const p = paths();
    const keep = { maxBytes: 1024 * 1024, keep: 2 };
    for (let day = 0; day < 5; day++) appendWreck(p, "fake", wreck(day), keep, DAY1 + day * 86_400_000);
    const archives = listArchives(p);
    expect(archives.map((a) => a.stamp)).toEqual(["20261111T100000000Z", "20261112T100000000Z"]);
    expect(readGraveyard(file(), "fake")?.map((w) => w.roundId)).toEqual(["r-2", "r-3", "r-4"]);
  });

  it("finishes a rotation a crash stopped, and never reads a file twice", () => {
    const p = paths();
    appendWreck(p, "fake", wreck(1), BIG, DAY1);
    appendWreck(p, "fake", wreck(2), BIG, DAY2);
    const [archive] = listArchives(p);
    // Stopped after compressing, before removing the plain copy.
    const plain = archive.file.slice(0, -".gz".length);
    writeFileSync(plain, gunzipSync(readFileSync(archive.file)));
    expect(readGraveyard(file(), "fake")).toHaveLength(2);

    // Stopped after the rename, before compressing at all.
    const stray = join(dir, "wrecks-fake.20261108T000000000Z.ndjson");
    writeFileSync(stray, `${JSON.stringify({ k: "head", network: "fake", startedAt: "2026-11-08T00:00:00.000Z" })}\n${JSON.stringify({ k: "wreck", ...wreck(0) })}\n`);
    expect(readGraveyard(file(), "fake")?.map((w) => w.roundId)).toEqual(["r-0", "r-1", "r-2"]);

    rotateGraveyard(p, BIG, DAY2 + 86_400_000);
    expect(names().filter((n) => n.endsWith(".ndjson") && n !== "wrecks-fake.ndjson")).toEqual([]);
    expect(readGraveyard(file(), "fake")?.map((w) => w.roundId)).toEqual(["r-0", "r-1", "r-2"]);
  });

  it("refuses a rotated file from another network", () => {
    const stray = join(dir, "wrecks-fake.20261108T000000000Z.ndjson.gz");
    writeFileSync(stray, gzipSync(`${JSON.stringify({ k: "head", network: "base-sepolia", startedAt: "2026-11-08T00:00:00.000Z" })}\n`));
    expect(() => readGraveyard(file(), "fake")).toThrow(StoreNetworkMismatch);
  });

  it("reads its limits from the environment, and refuses nonsense", () => {
    expect(graveyardOptions({} as NodeJS.ProcessEnv)).toEqual({ maxBytes: 4 * 1024 * 1024, keep: 60 });
    expect(graveyardOptions({ SERVPIT_GRAVEYARD_ROTATE_MB: "16", SERVPIT_GRAVEYARD_KEEP: "7" } as unknown as NodeJS.ProcessEnv)).toEqual({ maxBytes: 16 * 1024 * 1024, keep: 7 });
    expect(() => graveyardOptions({ SERVPIT_GRAVEYARD_KEEP: "0" } as unknown as NodeJS.ProcessEnv)).toThrow(/SERVPIT_GRAVEYARD_KEEP/);
  });
});

describe("every reader, across every file", () => {
  /** The old single file, two rotated files and the active one, oldest to newest. */
  function spread(): void {
    writeFileSync(file(), JSON.stringify({ network: "fake", version: 1, wrecks: [wreck(0), wreck(1)] }));
    const p = paths();
    appendWreck(p, "fake", wreck(2), BIG, DAY1);
    appendWreck(p, "fake", wreck(3), BIG, DAY2);
    appendWreck(p, "fake", wreck(4), BIG, DAY2 + 86_400_000);
    appendWreck(p, "fake", wreck(5), BIG, DAY2 + 86_400_000);
    expect(listArchives(p)).toHaveLength(2);
  }

  it("the wreck store sees all of it: all, has, countFor, countSince and lastFor", () => {
    spread();
    const store = new WreckStore(file(), "fake", BIG);
    expect(store.all().map((w) => w.roundId)).toEqual(["r-0", "r-1", "r-2", "r-3", "r-4", "r-5"]);
    expect(store.has("r-0", "atlas")).toBe(true);
    expect(store.has("r-3", "delta")).toBe(true);
    expect(store.countFor("atlas")).toBe(1);
    expect(store.countSince(DAY1 + 2_000)).toBe(4);
    expect(store.lastFor("ember")?.roundId).toBe("r-4");
  });

  it("a later record for the same round and seat replaces an earlier one, wherever each is", () => {
    spread();
    const store = new WreckStore(file(), "fake", BIG);
    store.save(wreck(0, { name: "Rewritten" }));
    const all = store.all();
    expect(all).toHaveLength(6);
    expect(all[0]).toMatchObject({ roundId: "r-0", name: "Rewritten" });
  });

  it("a second store over the same files sees what the first wrote, through a rotation", () => {
    const writer = new WreckStore(file(), "fake", { maxBytes: 600, keep: 60 });
    const reader = new WreckStore(file(), "fake", { maxBytes: 600, keep: 60 });
    expect(reader.all()).toEqual([]);
    for (let n = 0; n < 6; n++) writer.save(wreck(n));
    expect(listArchives(paths()).length).toBeGreaterThan(0);
    expect(reader.all().map((w) => w.roundId)).toEqual(["r-0", "r-1", "r-2", "r-3", "r-4", "r-5"]);
  });

  it("the stats report reads it all, and still says absent when there is none", () => {
    expect(loadStores(dir, "fake").wrecks).toBeNull();
    spread();
    expect(loadStores(dir, "fake").wrecks?.map((w) => (w as { roundId: string }).roundId)).toEqual(["r-0", "r-1", "r-2", "r-3", "r-4", "r-5"]);
  });

  it("still reads the old single file alone, as every earlier build left it", () => {
    writeFileSync(file(), JSON.stringify({ network: "fake", version: 1, wrecks: [wreck(0)] }));
    expect(new WreckStore(file(), "fake", BIG).all()).toHaveLength(1);
    renameSync(file(), join(dir, "elsewhere.json"));
    expect(new WreckStore(file(), "fake", BIG).all()).toEqual([]);
  });
});
