import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StoreNetworkMismatch } from "../store/file";
import { PickStore } from "./picks";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-picks-"));
  file = join(dir, "picks-fake.ndjson");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const store = (): PickStore => new PickStore(file, "fake");

describe("recording a pick", () => {
  it("reads back what was written, for the round it was written for", () => {
    const s = store();
    expect(s.record("r-1", "ash", "hash-ash", "atlas")).toBe("recorded");
    expect(s.pickOf("r-1", "ash")).toBe("atlas");
    expect(s.pickOf("r-2", "ash")).toBeNull();
  });

  it("is one pick per handle per round, the last one made while the window is open", () => {
    const s = store();
    s.record("r-1", "ash", "hash-ash", "atlas");
    s.record("r-1", "ash", "hash-ash", "vex");
    expect(s.pickOf("r-1", "ash")).toBe("vex");
    expect(s.countsFor("r-1")).toEqual({ vex: 1 });
  });

  it("counts backers per agent, which is what the pari mutuel split needs", () => {
    const s = store();
    s.record("r-1", "ash", "h1", "atlas");
    s.record("r-1", "bowen", "h2", "atlas");
    s.record("r-1", "cyan", "h3", "vex");
    expect(s.countsFor("r-1")).toEqual({ atlas: 2, vex: 1 });
    expect(s.picksFor("r-1").size).toBe(3);
  });

  it("refuses a pick under a handle somebody else claimed first", () => {
    const s = store();
    s.record("r-1", "ash", "hash-ash", "atlas");
    expect(s.record("r-1", "ash", "somebody-else", "vex")).toBe("handle taken");
    // The first pick stands, untouched by the attempt.
    expect(s.pickOf("r-1", "ash")).toBe("atlas");
  });

  it("keeps a handle across rounds, so the same person is the same backer", () => {
    const s = store();
    s.record("r-1", "ash", "hash-ash", "atlas");
    expect(s.record("r-2", "ash", "hash-ash", "vex")).toBe("recorded");
    expect(s.record("r-2", "ash", "wrong", "flint")).toBe("handle taken");
  });
});

describe("reading a log that another process is writing", () => {
  it("sees what was appended after it last looked", () => {
    const s = store();
    s.record("r-1", "ash", "h1", "atlas");
    expect(s.countsFor("r-1")).toEqual({ atlas: 1 });
    // A second writer, which is what a second request is.
    appendFileSync(file, JSON.stringify({ k: "pick", roundId: "r-1", handle: "bowen", agentId: "vex", at: "2026-09-22T00:00:00.000Z" }) + "\n");
    appendFileSync(file, JSON.stringify({ k: "claim", handle: "bowen", tokenHash: "h2", at: "2026-09-22T00:00:00.000Z" }) + "\n");
    expect(s.countsFor("r-1")).toEqual({ atlas: 1, vex: 1 });
  });

  it("ignores a torn line rather than losing the whole log to it", () => {
    const s = store();
    s.record("r-1", "ash", "h1", "atlas");
    // A line cut in half is what a crash mid append leaves behind.
    appendFileSync(file, '{"k":"pick","roundId":"r-1","han');
    appendFileSync(file, "\n" + JSON.stringify({ k: "pick", roundId: "r-1", handle: "cyan", agentId: "vex", at: "2026-09-22T00:00:00.000Z" }) + "\n");
    expect(s.countsFor("r-1")).toEqual({ atlas: 1, vex: 1 });
  });

  it("refuses a log from another chain, like every other store", () => {
    writeFileSync(file, JSON.stringify({ k: "head", network: "base-sepolia" }) + "\n");
    expect(() => store().countsFor("r-1")).toThrow(StoreNetworkMismatch);
  });

  it("stamps the log it creates with the network it is on", () => {
    store().record("r-1", "ash", "h1", "atlas");
    const head = JSON.parse(readFileSync(file, "utf8").split("\n")[0]!) as { k: string; network: string };
    expect(head).toMatchObject({ k: "head", network: "fake" });
  });
});
