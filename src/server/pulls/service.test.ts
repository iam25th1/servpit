import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArenaPhase, ArenaState } from "../arena/state";
import { PullStore } from "./log";
import { requestPull } from "./service";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const store = (): PullStore => {
  dir = mkdtempSync(join(tmpdir(), "servpit-pull-service-"));
  return new PullStore(join(dir, "pulls-fake.ndjson"), "fake");
};

const state = (phase: ArenaPhase | null): ArenaState => ({
  round:
    phase === null
      ? null
      : ({
          roundId: "r-1",
          startedAt: "2026-09-22T00:00:00.000Z",
          phase,
          phases: [{ phase, at: "2026-09-22T00:00:00.000Z" }],
          network: "fake",
          backend: "fake",
          entrants: 24,
          bots: 20,
          stakeChips: 10,
          weiPerChip: "1",
          decisions: [],
          loans: [],
          refusals: [],
          bank: null,
          entries: [],
        } as ArenaState["round"]),
  last: null,
  paused: false,
  nextRoundAt: null,
  updatedAt: "2026-09-22T00:00:00.000Z",
});

const token = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

describe("asking the pit for a round", () => {
  it("takes the ask while the pit is resting", () => {
    const answer = requestPull(state("resting"), { handle: "ash", token }, { store: store(), arenaMode: true });
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.view.queued).toBe(true);
  });

  it("tells nobody anything about the round", () => {
    // The resolver is deterministic, so a seed is a winner. This path answers
    // with a sentence and a flag, and that is the whole shape of it.
    const answer = requestPull(state("resting"), { handle: "ash", token }, { store: store(), arenaMode: true });
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(Object.keys(answer.view).sort()).toEqual(["message", "queued"]);
  });

  it("refuses while a round is running, and costs the asker nothing", () => {
    const log = store();
    const answer = requestPull(state("fight"), { handle: "ash", token }, { store: log, arenaMode: true });
    expect(answer).toMatchObject({ ok: false, status: 409 });
    expect(log.pending()).toBeNull();
  });

  it("refuses a second ask while one is waiting", () => {
    const log = store();
    expect(requestPull(state("resting"), { handle: "ash", token }, { store: log, arenaMode: true }).ok).toBe(true);
    const second = requestPull(state("resting"), { handle: "bee", token: other }, { store: log, arenaMode: true });
    expect(second).toMatchObject({ ok: false, status: 409 });
    if (!second.ok) expect(second.message).toMatch(/starting now/);
  });

  it("keeps a handle on the browser that claimed it, here and in the backing log", () => {
    const log = store();
    const answer = requestPull(
      state("resting"),
      { handle: "ash", token },
      { store: log, arenaMode: true, backingOwner: () => "some-other-hash" },
    );
    expect(answer).toMatchObject({ ok: false, status: 409 });
    expect(log.pending()).toBeNull();
  });

  it("says what is wrong with the request before what is wrong with the moment", () => {
    const answer = requestPull(state("fight"), { handle: "no", token }, { store: store(), arenaMode: true });
    expect(answer).toMatchObject({ ok: false, status: 400 });
    if (!answer.ok) expect(answer.message).toMatch(/handle/);
  });

  it("refuses a browser with no token", () => {
    const answer = requestPull(state("resting"), { handle: "ash", token: "" }, { store: store(), arenaMode: true });
    expect(answer).toMatchObject({ ok: false, status: 400 });
  });

  it("is closed when the pit is not running itself", () => {
    const answer = requestPull(state("resting"), { handle: "ash", token }, { store: store(), arenaMode: false });
    expect(answer).toMatchObject({ ok: false, status: 403 });
  });
});
