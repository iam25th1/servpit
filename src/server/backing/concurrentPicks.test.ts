// Many viewers backing at the same moment, from separate processes.
//
// This is the case a JSON store cannot survive: every writer would read the
// whole file, add its pick and write the file back, so the picks that landed
// between one writer's read and its write are gone. Both writes are
// legitimate, which is why the later one replacing the earlier one is a lost
// pick rather than a resolved conflict.
//
// Separate processes rather than promises in one: appendFileSync is
// synchronous, so a single process cannot interleave with itself and would
// prove nothing about the thing being claimed.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PickStore } from "./picks";

let dir: string;
let file: string;

const fixture = fileURLToPath(new URL("./picks.fixture.ts", import.meta.url));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-crowd-"));
  file = join(dir, "picks-fake.ndjson");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const backer = (prefix: string, count: number, agentId: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", fixture, file, prefix, String(count), agentId], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });

describe("a crowd backing at once", () => {
  it("loses none of them", { timeout: 120_000 }, async () => {
    const writers = ["ash", "bo", "cy", "di", "el", "fi"];
    const each = 20;
    const codes = await Promise.all(writers.map((prefix, i) => backer(prefix, each, i % 2 === 0 ? "atlas" : "vex")));
    expect(codes).toEqual(writers.map(() => 0));

    const store = new PickStore(file, "fake");
    const picks = store.picksFor("r-crowd");
    expect(picks.size).toBe(writers.length * each);
    const counts = store.countsFor("r-crowd");
    expect(counts.atlas! + counts.vex!).toBe(writers.length * each);

    // Every line is whole, which is the property O_APPEND gives for writes
    // this size and the reason this store appends rather than rewrites.
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    // A head line, a claim per backer and a pick per backer.
    expect(lines).toHaveLength(1 + 2 * writers.length * each);
  });
});
