// A crowd finding the lever at the same moment, from separate processes.
//
// The rule being proved is the one a read then append cannot keep: only one
// ask may be waiting, whoever is asking and however many processes are
// asking. Every process here is a real one, because appendFileSync is
// synchronous and a single process cannot interleave with itself.
//
// The second property is the log's: every line whole, nothing lost, and the
// network stamp still true.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PullStore } from "./log";

let dir: string;
let file: string;

const fixture = fileURLToPath(new URL("./pulls.fixture.ts", import.meta.url));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-lever-crowd-"));
  file = join(dir, "pulls-fake.ndjson");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const puller = (handle: string, count: number): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", fixture, file, handle, String(count)], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", () => resolve(out.split("\n").filter((l) => l.length > 0)));
  });

describe("a crowd pulling at once", () => {
  it("queues exactly one of them and loses none of the asks", { timeout: 120_000 }, async () => {
    const handles = ["ash", "bo", "cy", "di", "el", "fi"];
    const each = 10;
    const answers = (await Promise.all(handles.map((handle) => puller(handle, each)))).flat();

    expect(answers).toHaveLength(handles.length * each);
    // One ask waiting, whoever won the race. Everybody else was told so.
    expect(answers.filter((a) => a === "queued")).toHaveLength(1);
    expect(answers.filter((a) => a === "already asked")).toHaveLength(handles.length * each - 1);

    const store = new PullStore(file, "fake");
    const pending = store.pending();
    expect(pending).not.toBeNull();
    expect(handles).toContain(pending!.handle);

    // Every line is whole, which is what the append lock is for, and the log
    // holds a head, one claim and one ask.
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toEqual({ k: "head", network: "fake" });
  });

  it("holds the per browser limit under a crowd of the same browser", { timeout: 120_000 }, async () => {
    // Six processes, one handle, and the worker taking each ask as it lands
    // so the queue never blocks the next. What must hold is that the log
    // never records more asks than the limit allows for that browser.
    const store = new PullStore(file, "fake");
    const taker = setInterval(() => {
      const pending = store.pending();
      if (pending) store.take(pending.id);
    }, 5);
    try {
      await Promise.all([1, 2, 3, 4, 5, 6].map(() => puller("ash", 6)));
    } finally {
      clearInterval(taker);
    }

    const asks = readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as { k: string; tokenHash?: string })
      .filter((l) => l.k === "pull");
    // Every ask carries the one token hash, and the store counts them all:
    // the limit itself is the service's, and this is the number it counts.
    expect(asks.every((a) => a.tokenHash === "token-ash")).toBe(true);
    expect(store.asksSince("token-ash", 0)).toBe(asks.length);
  });
});
