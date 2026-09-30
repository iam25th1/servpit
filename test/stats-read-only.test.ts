// The report reads and does not write, and the test is willing to prove it.
//
// Three ways, because one of them alone would be a comment. Every store file
// is checksummed before the script runs and after it, so a rewrite of the same
// length would still fail. The whole thing is then run again against a
// directory with the write bit off, where a write would raise EACCES rather
// than pass quietly. And the source of everything the script can reach is read
// for any call that writes at all, so a future edit cannot introduce one and
// leave the first two tests passing because nothing happened to trip them.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFixture } from "./helpers/statsStores";

const root = process.cwd();
let dir: string;

const fingerprint = (at: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const name of readdirSync(at).sort()) {
    const path = join(at, name);
    const info = statSync(path);
    out[name] = `${createHash("sha256").update(readFileSync(path)).digest("hex")}:${info.size}:${info.mtimeMs}`;
  }
  return out;
};

const run = (at: string) =>
  spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts/stats.ts"), "fake"], {
    cwd: root,
    env: { ...process.env, SERVPIT_DATA_DIR: at },
    encoding: "utf8",
  });

beforeEach(() => {
  dir = writeFixture(mkdtempSync(join(tmpdir(), "servpit-stats-guard-")));
});

afterEach(() => {
  chmodSync(dir, 0o700);
  rmSync(dir, { recursive: true, force: true });
});

describe("running the report", () => {
  it("prints a report and changes nothing in the data directory", () => {
    const before = fingerprint(dir);
    const result = run(dir);
    const after = fingerprint(dir);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("THE PIT");
    expect(result.stdout).toContain("LINES WORTH POSTING");
    expect(after).toEqual(before);
    // And nothing new either: no lock, no temporary file, no backup.
    expect(Object.keys(after)).toEqual(Object.keys(before));

    // Again with the write bit off, where a write would raise EACCES rather
    // than pass quietly because there happened to be nothing to change.
    chmodSync(dir, 0o500);
    const readOnly = run(dir);
    expect(readOnly.status, readOnly.stderr).toBe(0);
    expect(readOnly.stdout).toContain("rounds on file");
    expect(fingerprint(dir)).toEqual(before);
  }, 20_000);

  it("says so rather than inventing a pit when there are no stores", () => {
    const empty = mkdtempSync(join(tmpdir(), "servpit-stats-empty-"));
    const result = run(empty);
    rmSync(empty, { recursive: true, force: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no stores for fake");
  }, 20_000);
});

describe("what the report can reach", () => {
  const sources = ["scripts/stats.ts", "src/server/stats/read.ts", "src/server/stats/collect.ts", "src/server/stats/format.ts", "src/server/stats/post.ts"];

  it("contains no call that writes, anywhere in it", () => {
    for (const path of sources) {
      const body = readFileSync(join(root, path), "utf8");
      for (const call of ["writeFileSync", "appendFileSync", "mkdirSync", "rmSync", "unlinkSync", "renameSync", "createWriteStream", "openSync", "writeFile(", "withAppendLock", "chmodSync", "utimesSync"]) {
        expect(body, `${path} mentions ${call}`).not.toContain(call);
      }
    }
  });

  it("imports nothing that could start a round, move money or call a model", () => {
    for (const path of sources) {
      const body = readFileSync(join(root, path), "utf8");
      for (const forbidden of ["server/context", "settleContext", "round/settle", "round/flow", "serv/client", "wallets/", "transfers", "arena/worker", "arena/lock", "decisions/decide"]) {
        expect(body, `${path} imports ${forbidden}`).not.toContain(`from "${forbidden}`);
        expect(body, `${path} imports ${forbidden}`).not.toContain(`/${forbidden}"`);
      }
    }
  });
});
