// The stream has to stay open through a pit that is doing nothing.
//
// A rest lasts until the next round, an hour by default, and this stream only
// speaks when a phase changes. A proxy cannot tell a quiet connection from a
// dead one: Cloudflare closes a proxied response that has sent nothing for
// about a hundred seconds, and a spectator watching an empty pit would be
// dropped and have to reconnect for as long as the rest lasted.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

beforeEach(() => {
  vi.useFakeTimers();
  dir = mkdtempSync(join(tmpdir(), "servpit-stream-"));
  vi.stubEnv("WALLET_BACKEND", "fake");
  vi.stubEnv("SERVPIT_DATA_DIR", dir);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
  rmSync(dir, { recursive: true, force: true });
});

/** An arena file with one round in it, written the way the worker writes it. */
function writeArena(phase: string): void {
  writeFileSync(
    join(dir, "arena-fake.json"),
    JSON.stringify({
      network: "fake",
      round: { roundId: "r-1", startedAt: "2026-09-22T00:00:00.000Z", phase, phases: [{ phase, at: "2026-09-22T00:00:00.000Z" }], network: "fake", backend: "fake", entrants: 24, bots: 18, stakeChips: 10, weiPerChip: "1000000000000", decisions: [], loans: [], refusals: [], bank: null, entries: [] },
      last: null,
      paused: false,
      nextRoundAt: null,
      updatedAt: "2026-09-22T00:00:00.000Z",
    }),
  );
}

async function subscribe(pollMs: number, heartbeatMs: number) {
  const { streamPhases } = await import("./stream");
  const events: string[] = [];
  const pings: number[] = [];
  const controller = new AbortController();
  streamPhases({
    signal: controller.signal,
    send: (event) => events.push(event),
    ping: () => pings.push(1),
    close: () => events.push("closed"),
    pollMs,
    heartbeatMs,
  });
  return { events, pings, controller };
}

describe("a stream through a quiet pit", () => {
  it("sends the phase once, then nothing until the heartbeat is due", async () => {
    writeArena("resting");
    const { events, pings } = await subscribe(1_000, 20_000);
    expect(events).toEqual(["phase"]);

    await vi.advanceTimersByTimeAsync(19_000);
    expect(pings).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pings).toHaveLength(1);
    expect(events).toEqual(["phase"]);
  });

  it("keeps sending them, so an hour of rest is an hour of connection", async () => {
    writeArena("resting");
    const { pings } = await subscribe(1_000, 20_000);
    await vi.advanceTimersByTimeAsync(100_000);
    // Well inside the hundred seconds a proxied connection is given.
    expect(pings.length).toBeGreaterThanOrEqual(4);
  });

  it("does not send one when the pit is talking anyway", async () => {
    writeArena("deciding");
    const { events, pings } = await subscribe(1_000, 5_000);
    for (const phase of ["settling", "reels", "backing", "fight"]) {
      await vi.advanceTimersByTimeAsync(4_000);
      writeArena(phase);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(events.filter((e) => e === "phase")).toHaveLength(5);
    expect(pings).toHaveLength(0);
  });

  it("stops when the client goes away", async () => {
    writeArena("resting");
    const { pings, controller } = await subscribe(1_000, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pings).toHaveLength(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pings).toHaveLength(1);
  });
});
