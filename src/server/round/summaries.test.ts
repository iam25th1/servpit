// The line that outlives the round record.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SummaryStore, classOfSources, summaryFile, type RoundSummary } from "./summaries";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-summaries-"));
  file = summaryFile(dir, "fake");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const row = (over: Partial<RoundSummary> = {}): RoundSummary => ({
  roundId: "r-1",
  at: "2026-09-30T00:00:00.000Z",
  entrants: 24,
  winner: "bot-04",
  potWei: "20000000000000",
  answers: "reasoned",
  servCalls: 6,
  servMicroCents: 1_485_000,
  tokensIn: 7_200,
  tokensOut: 900,
  reconciled: true,
  ...over,
});

describe("keeping one line per round", () => {
  it("appends and reads back, with the network in a head line", () => {
    const store = new SummaryStore(file, "fake");
    expect(store.append(row())).toBe(true);
    expect(store.all()).toEqual([row()]);
    expect(readFileSync(file, "utf8").split("\n")[0]).toBe(JSON.stringify({ k: "head", network: "fake" }));
  });

  it("never trims, however many rounds it holds", () => {
    const store = new SummaryStore(file, "fake");
    for (let i = 0; i < 250; i++) store.append(row({ roundId: `r-${i}`, at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString() }));
    // The round store keeps 200. This keeps everything.
    expect(store.all()).toHaveLength(250);
    expect(store.all()[0]?.roundId).toBe("r-0");
  });

  it("orders by when the round was played, with undated rounds last", () => {
    const store = new SummaryStore(file, "fake");
    store.append(row({ roundId: "r-late", at: "2026-09-30T10:00:00.000Z" }));
    store.append(row({ roundId: "r-unknown", at: null }));
    store.append(row({ roundId: "r-early", at: "2026-09-21T10:00:00.000Z" }));
    expect(store.all().map((r) => r.roundId)).toEqual(["r-early", "r-late", "r-unknown"]);
  });

  it("does not write a round twice", () => {
    const store = new SummaryStore(file, "fake");
    expect(store.append(row())).toBe(true);
    expect(store.append(row({ winner: "bot-09" }))).toBe(false);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]?.winner).toBe("bot-04");
  });

  it("lets a settle's line replace a backfilled one, and never the other way round", () => {
    const store = new SummaryStore(file, "fake");
    store.append(row({ winner: null, answers: null, backfilled: true }));
    // The settle was there, so its line wins.
    expect(store.append(row())).toBe(true);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]).toEqual(row());
    // And a later backfill leaves it alone.
    expect(store.append(row({ winner: null, answers: null, backfilled: true }))).toBe(false);
    expect(store.all()[0]?.winner).toBe("bot-04");
  });

  it("keeps unknown fields as null rather than filling them in", () => {
    const store = new SummaryStore(file, "fake");
    store.append(row({ at: "2026-09-21T00:00:00.000Z", entrants: null, winner: null, potWei: null, answers: null, servCalls: null, servMicroCents: null, tokensIn: null, tokensOut: null, reconciled: null, backfilled: true }));
    const kept = store.all()[0]!;
    expect(kept.winner).toBeNull();
    expect(kept.answers).toBeNull();
    expect(kept.reconciled).toBeNull();
    expect(kept.backfilled).toBe(true);
  });

  it("skips a line torn by a crash and keeps every whole line around it", () => {
    const store = new SummaryStore(file, "fake");
    store.append(row({ roundId: "r-1" }));
    store.append(row({ roundId: "r-3", at: "2026-09-30T02:00:00.000Z" }));
    // A half line between two whole ones, which is what a crash mid append
    // leaves behind once the next append has landed after it.
    const lines = readFileSync(file, "utf8").split("\n");
    lines.splice(2, 0, '{"k":"round","roundId":"r-to');
    writeFileSync(file, lines.join("\n"));

    expect(new SummaryStore(file, "fake").all().map((r) => r.roundId)).toEqual(["r-1", "r-3"]);
  });

  it("refuses a file written for another network", () => {
    writeFileSync(file, `${JSON.stringify({ k: "head", network: "base-sepolia" })}\n`);
    expect(() => new SummaryStore(file, "fake").all()).toThrow(/base-sepolia/);
  });
});

describe("what a round's decisions add up to", () => {
  it("is the same rule the report uses", () => {
    expect(classOfSources(["heuristic", "serv"])).toBe("reasoned");
    expect(classOfSources(["heuristic", "learned"])).toBe("learned");
    expect(classOfSources(["heuristic", "heuristic"])).toBe("instinct");
  });

  it("is null rather than instinct when there is nothing to read", () => {
    expect(classOfSources([])).toBeNull();
    expect(classOfSources([undefined])).toBeNull();
  });
});
