// The one time clean up of the graveyard, run on a copy.
//
// The fixture is shaped like the live file: a handful of real retirements
// among thousands of rows the empty bank loop wrote, plus rows that look
// like churn and must not be taken for it. The live file is never touched:
// every test writes its own, and the script test runs on a copy of that.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compactGraveyard, isEmptyBankChurn } from "./compactGraveyard";
import { graveyardPaths, listArchives } from "./graveyard";
import { MAX_ROUNDS } from "./store";
import { WreckStore, type WreckRecord } from "./wrecks";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-compact-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const BIG = { maxBytes: 64 * 1024 * 1024, keep: 60 };
const NOW = Date.parse("2026-11-10T03:00:00.000Z");
const sha = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

/** A row the loop wrote: seated short, refused, retired without doing a thing. */
function churn(n: number): WreckRecord {
  return {
    roundId: `r-churn-${n}`,
    walletId: "flint",
    identityId: `flint-${n + 10}`,
    name: "Rime",
    face: "Eskimo",
    trigger: "broke and denied credit",
    balanceAtDeathWei: "28092173875775",
    debtAtDeathWei: "0",
    principalAtDeathWei: "0",
    interestAtDeathWei: "0",
    seizedWei: "0",
    writtenOffWei: "0",
    peakBalanceWei: "28092173875775",
    borrowedWei: "0",
    loanCount: 0,
    recentStakeMultiples: [],
    roundsSurvived: 1 + (n % 3),
    wins: 0,
    at: new Date(Date.parse("2026-10-01T00:00:00.000Z") + n * 60_000).toISOString(),
  };
}

/** An agent that played, borrowed and went under: a real retirement. */
function real(n: number): WreckRecord {
  return {
    ...churn(n),
    roundId: `r-real-${n}`,
    walletId: "blaze",
    identityId: `blaze-${n + 2}`,
    name: "Blaze",
    trigger: "debt above the ceiling",
    debtAtDeathWei: "25650000000000",
    principalAtDeathWei: "19000000000000",
    interestAtDeathWei: "6650000000000",
    writtenOffWei: "25650000000000",
    borrowedWei: "19000000000000",
    loanCount: 1,
    recentStakeMultiples: [1, 2.7],
    roundsSurvived: 27,
    wins: 1,
    at: new Date(Date.parse("2026-09-21T22:26:20.296Z") + n * 60_000).toISOString(),
  };
}

/** Rows that match most of the churn rule and must be kept for the part they miss. */
const lookalikes: WreckRecord[] = [
  // One of the six originals, funded at the start.
  { ...churn(9001), roundId: "r-original", identityId: "ember-1" },
  // A life longer than the round store remembers, so "never entered" is not known.
  { ...churn(9002), roundId: "r-long", roundsSurvived: MAX_ROUNDS },
  // Played within itself and lost, never borrowing.
  { ...churn(9003), roundId: "r-played", recentStakeMultiples: [1] },
  // A row from before a field was kept.
  (() => {
    const old = { ...churn(9004), roundId: "r-old-shape" } as Partial<WreckRecord>;
    delete old.recentStakeMultiples;
    return old as WreckRecord;
  })(),
];

function legacy(rows: WreckRecord[], mtime = NOW - 60 * 60 * 1000): string {
  const file = join(dir, "wrecks-fake.json");
  writeFileSync(file, `${JSON.stringify({ network: "fake", version: 1, wrecks: rows, updatedAt: "2026-11-10T01:47:20.174Z" }, null, 2)}\n`);
  utimesSync(file, new Date(mtime), new Date(mtime));
  return file;
}

const rows = (): WreckRecord[] => [...Array.from({ length: 5 }, (_, n) => real(n)), ...Array.from({ length: 2000 }, (_, n) => churn(n)), ...lookalikes];

describe("which rows are churn", () => {
  it("takes a row only when the row itself proves it", () => {
    expect(isEmptyBankChurn(churn(1))).toBe(true);
    expect(isEmptyBankChurn(real(1))).toBe(false);
    for (const row of lookalikes) expect(isEmptyBankChurn(row)).toBe(false);
  });
});

describe("compacting a copy of the graveyard", () => {
  it("keeps the real rows, backs up the old file untouched, and shrinks what the pit reads", () => {
    const file = legacy(rows());
    const before = sha(file);
    const beforeBytes = statSync(file).size;
    const beforeMtime = statSync(file).mtimeMs;

    const report = compactGraveyard({ file, network: "fake", graveyard: BIG, now: NOW });

    expect(report.rowsBefore).toBe(2009);
    expect(report.churnRemoved).toBe(2000);
    expect(report.rowsKept).toBe(9);
    // The old file is gone from where the pit reads, and is beside it, byte for byte.
    expect(existsSync(file)).toBe(false);
    expect(report.backup?.file).toBe(`${file}.backup-20261110T030000000Z`);
    expect(sha(report.backup!.file)).toBe(before);
    expect(statSync(report.backup!.file).mtimeMs).toBe(beforeMtime);
    // What is kept is one compressed file in the new format, read by the store.
    const archives = listArchives(graveyardPaths(file));
    expect(archives).toHaveLength(1);
    expect(archives[0].compressed).toBe(true);
    const kept = new WreckStore(file, "fake", BIG).all().map((w) => w.roundId).sort();
    expect(kept).toEqual(["r-long", "r-old-shape", "r-original", "r-played", "r-real-0", "r-real-1", "r-real-2", "r-real-3", "r-real-4"]);
    // Sizes before and after, every file.
    expect(report.before).toEqual([{ file, bytes: beforeBytes, rows: 2009 }]);
    expect(report.after.reduce((sum, f) => sum + f.bytes, 0)).toBeLessThan(beforeBytes / 50);
  });

  it("only rotates and compresses when told to keep the churn", () => {
    const file = legacy(rows());
    const report = compactGraveyard({ file, network: "fake", graveyard: BIG, keepChurn: true, now: NOW });
    expect(report.churnRemoved).toBe(0);
    expect(new WreckStore(file, "fake", BIG).all()).toHaveLength(2009);
    expect(report.after.every((f) => f.file.endsWith(".ndjson.gz"))).toBe(true);
  });

  it("sets aside and compresses the active file too", () => {
    const file = legacy([real(0)]);
    const store = new WreckStore(file, "fake", BIG);
    store.save(real(1));
    compactGraveyard({ file, network: "fake", graveyard: BIG, now: NOW });
    expect(existsSync(graveyardPaths(file).active)).toBe(false);
    expect(listArchives(graveyardPaths(file))).toHaveLength(2);
    expect(new WreckStore(file, "fake", BIG).all().map((w) => w.roundId)).toEqual(["r-real-0", "r-real-1"]);
  });

  it("writes nothing on a dry run", () => {
    const file = legacy(rows());
    const before = readdirSync(dir);
    const report = compactGraveyard({ file, network: "fake", graveyard: BIG, dryRun: true, now: NOW });
    expect(report.churnRemoved).toBe(2000);
    expect(readdirSync(dir)).toEqual(before);
  });

  it("refuses an old file written in the last ten minutes, because an older build may still be writing it", () => {
    const file = legacy(rows(), NOW - 60_000);
    expect(() => compactGraveyard({ file, network: "fake", graveyard: BIG, now: NOW })).toThrow(/last ten minutes/);
    expect(existsSync(file)).toBe(true);
    expect(compactGraveyard({ file, network: "fake", graveyard: BIG, now: NOW, force: true }).churnRemoved).toBe(2000);
  });
});

describe("npm run compact-graveyard", () => {
  it("runs on a copy and prints the sizes before and after", () => {
    const original = legacy(rows());
    const copy = join(dir, "copy");
    mkdirSync(copy);
    copyFileSync(original, join(copy, "wrecks-fake.json"));
    utimesSync(join(copy, "wrecks-fake.json"), new Date(NOW - 3_600_000), new Date(NOW - 3_600_000));
    const originalSha = sha(original);

    const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const run = spawnSync(process.execPath, [tsx, "scripts/compact-graveyard.ts", "fake"], {
      cwd: process.cwd(),
      env: { ...process.env, SERVPIT_DATA_DIR: copy, NODE_ENV: "test" },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/^before$/m);
    expect(run.stdout).toMatch(/^after$/m);
    expect(run.stdout).toMatch(/kept 9 of 2,009 rows, took out 2,000 empty bank churn rows/);
    expect(run.stdout).toMatch(/backup, untouched: .*wrecks-fake\.json\.backup-/);
    // The file it was copied from is exactly as it was.
    expect(sha(original)).toBe(originalSha);
  }, 60_000);
});
