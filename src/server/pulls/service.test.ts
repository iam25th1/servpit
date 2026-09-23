import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArenaPhase, ArenaState } from "../arena/state";
import { DEFAULT_PULL_SETTINGS, type PullSettings } from "./settings";
import { PullStore } from "./log";
import { requestPull } from "./service";
import { RateLimiter } from "../backing/limit";

/** Everything the service needs besides the log, with the defaults in force. */
const deps = (store: PullStore, over: { settings?: Partial<PullSettings>; spentCents?: number; reasoningOn?: boolean; now?: () => number; backingOwner?: (handle: string) => string | null } = {}) => {
  const settings = { ...DEFAULT_PULL_SETTINGS, ...over.settings };
  const budgetMicroCents = settings.dailyBudgetCents * 1_000_000;
  const spentMicroCents = (over.spentCents ?? 0) * 1_000_000;
  return {
    store,
    arenaMode: true,
    settings,
    budget: { spentMicroCents, budgetMicroCents, withinBudget: spentMicroCents < budgetMicroCents },
    reasoningOn: over.reasoningOn ?? true,
    backingOwner: over.backingOwner,
    now: over.now,
  };
};

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const store = (now?: () => number): PullStore => {
  dir = mkdtempSync(join(tmpdir(), "servpit-pull-service-"));
  return new PullStore(join(dir, "pulls-fake.ndjson"), "fake", now);
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
    const answer = requestPull(state("resting"), { handle: "ash", token }, deps(store()));
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.view.queued).toBe(true);
  });

  it("tells nobody anything about the round", () => {
    // The resolver is deterministic, so a seed is a winner. What comes back
    // is about the lever and this browser: nothing about the round it starts.
    const answer = requestPull(state("resting"), { handle: "ash", token }, deps(store()));
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(Object.keys(answer.view).sort()).toEqual(["left", "message", "queued", "reasonBlocked", "resetsAt", "willReason"]);
  });

  it("refuses while a round is running, and costs the asker nothing", () => {
    const log = store();
    const answer = requestPull(state("fight"), { handle: "ash", token }, deps(log));
    expect(answer).toMatchObject({ ok: false, status: 409 });
    expect(log.pending()).toBeNull();
  });

  it("refuses a second ask while one is waiting", () => {
    const log = store();
    expect(requestPull(state("resting"), { handle: "ash", token }, deps(log)).ok).toBe(true);
    const second = requestPull(state("resting"), { handle: "bee", token: other }, deps(log));
    expect(second).toMatchObject({ ok: false, status: 409 });
    if (!second.ok) expect(second.message).toMatch(/starting now/);
  });

  it("keeps a handle on the browser that claimed it, here and in the backing log", () => {
    const log = store();
    const answer = requestPull(
      state("resting"),
      { handle: "ash", token },
      deps(log, { backingOwner: () => "some-other-hash" }),
    );
    expect(answer).toMatchObject({ ok: false, status: 409 });
    expect(log.pending()).toBeNull();
  });

  it("says what is wrong with the request before what is wrong with the moment", () => {
    const answer = requestPull(state("fight"), { handle: "no", token }, deps(store()));
    expect(answer).toMatchObject({ ok: false, status: 400 });
    if (!answer.ok) expect(answer.message).toMatch(/handle/);
  });

  it("refuses a browser with no token", () => {
    const answer = requestPull(state("resting"), { handle: "ash", token: "" }, deps(store()));
    expect(answer).toMatchObject({ ok: false, status: 400 });
  });

  it("is closed when the pit is not running itself", () => {
    const answer = requestPull(state("resting"), { handle: "ash", token }, { ...deps(store()), arenaMode: false });
    expect(answer).toMatchObject({ ok: false, status: 403 });
  });

  it("stops a browser after its pulls for the window, and says when they come back", () => {
    let clock = Date.parse("2026-09-22T12:00:00.000Z");
    const at = () => clock;
    const log = store(at);
    for (let i = 0; i < 3; i += 1) {
      const answer = requestPull(state("resting"), { handle: "ash", token }, deps(log, { now: at }));
      expect(answer.ok, `pull ${i + 1}`).toBe(true);
      // The worker takes each one, so the next is not refused as a duplicate.
      log.take(log.pending()!.id);
      clock += 60_000;
    }
    const fourth = requestPull(state("resting"), { handle: "ash", token }, deps(log, { now: at }));
    expect(fourth).toMatchObject({ ok: false, status: 429 });
    if (!fourth.ok) expect(fourth.message).toMatch(/3 pulls/);
  });

  it("gives the pulls back when the window has passed", () => {
    let clock = Date.parse("2026-09-22T12:00:00.000Z");
    const at = () => clock;
    const log = store(at);
    for (let i = 0; i < 3; i += 1) {
      requestPull(state("resting"), { handle: "ash", token }, deps(log, { now: at }));
      log.take(log.pending()!.id);
      clock += 1_000;
    }
    expect(requestPull(state("resting"), { handle: "ash", token }, deps(log, { now: at })).ok).toBe(false);
    clock += 6 * 60 * 60_000 + 1;
    expect(requestPull(state("resting"), { handle: "ash", token }, deps(log, { now: at })).ok).toBe(true);
  });

  it("lets an operator turn the per browser limit off entirely", () => {
    let clock = Date.parse("2026-09-22T12:00:00.000Z");
    const at = () => clock;
    const log = store(at);
    for (let i = 0; i < 8; i += 1) {
      const answer = requestPull(state("resting"), { handle: "ash", token }, deps(log, { settings: { perIdentity: null, perHour: 100 }, now: at }));
      expect(answer.ok, `pull ${i + 1}`).toBe(true);
      if (answer.ok) expect(answer.view.left).toBeNull();
      log.take(log.pending()!.id);
      clock += 1_000;
    }
  });

  it("holds the hourly cap across everybody, whoever is asking", () => {
    let clock = Date.parse("2026-09-22T12:00:00.000Z");
    const at = () => clock;
    const log = store(at);
    const settings = { perIdentity: null, perHour: 2 };
    for (let i = 0; i < 2; i += 1) {
      expect(requestPull(state("resting"), { handle: `puller${i}`, token: `${i}1111111-1111-4111-8111-111111111111` }, deps(log, { settings, now: at })).ok).toBe(true);
      log.take(log.pending()!.id);
      clock += 1_000;
    }
    const third = requestPull(state("resting"), { handle: "puller9", token: "91111111-1111-4111-8111-111111111111" }, deps(log, { settings, now: at }));
    expect(third).toMatchObject({ ok: false, status: 429 });
    if (!third.ok) expect(third.message).toMatch(/2 rounds this hour/);

    // An hour later the cap has moved on and the lever works again.
    clock += 60 * 60_000 + 1;
    expect(requestPull(state("resting"), { handle: "puller9", token: "91111111-1111-4111-8111-111111111111" }, deps(log, { settings, now: at })).ok).toBe(true);
  });

  it("still pulls when the day's reasoning budget is spent, and says the round will not reason", () => {
    // The budget is about credit, not about rounds. Refusing the lever would
    // punish the viewer for something the operator's spend did.
    const answer = requestPull(state("resting"), { handle: "ash", token }, deps(store(), { spentCents: 25 }));
    expect(answer.ok).toBe(true);
    if (answer.ok) {
      expect(answer.view.queued).toBe(true);
      expect(answer.view.willReason).toBe(false);
      expect(answer.view.reasonBlocked).toMatch(/budget/);
      expect(answer.view.message).toMatch(/instinct/);
    }
  });

  it("says a round will not reason while the operator switch is off", () => {
    const answer = requestPull(state("resting"), { handle: "ash", token }, deps(store(), { reasoningOn: false }));
    expect(answer.ok).toBe(true);
    if (answer.ok) {
      expect(answer.view.willReason).toBe(false);
      expect(answer.view.reasonBlocked).toMatch(/switched off/);
    }
  });

  it("says a round will reason when nothing is in the way", () => {
    const answer = requestPull(state("resting"), { handle: "ash", token }, deps(store()));
    expect(answer.ok).toBe(true);
    if (answer.ok) {
      expect(answer.view.willReason).toBe(true);
      expect(answer.view.reasonBlocked).toBeNull();
      expect(answer.view.left).toBe(2);
      expect(answer.view.message).toMatch(/reason/);
    }
  });
});

describe("what the lever promises about reasoning", () => {
  it("never promises it where no key is configured, whatever the switch says", () => {
    // The switch being on cannot make a pit with no key reason, and a lever
    // that said otherwise would be promising something nobody can deliver.
    const answer = requestPull(
      state("resting"),
      { handle: "ash", token },
      { ...deps(store()), reasoningOn: true, reasoningConfigured: false },
    );
    expect(answer.ok).toBe(true);
    if (answer.ok) {
      expect(answer.view.willReason).toBe(false);
      expect(answer.view.reasonBlocked).toMatch(/no reasoning configured/);
    }
  });

  it("promises it when a key is configured and nothing else is in the way", () => {
    const answer = requestPull(state("resting"), { handle: "ash", token }, { ...deps(store()), reasoningConfigured: true });
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.view.willReason).toBe(true);
  });
});

describe("a flood of pulls from one place", () => {
  // The allowance in the log is kept under the browser's own token, so it
  // counts nothing against somebody presenting a new one every time.
  const fresh = () => `${crypto.randomUUID()}${crypto.randomUUID()}`;

  it("stops the lever being worked from one machine under new names", () => {
    const log = store();
    const crowd = new RateLimiter(1);
    const place = () => crowd.allow("one-address");
    const ask = (n: number) =>
      requestPull(state("resting"), { handle: `atk${n}`, token: fresh() }, { ...deps(log), crowd: place });

    expect(ask(1)).toMatchObject({ ok: true });
    const second = ask(2);
    expect(second).toMatchObject({ ok: false, status: 429 });
    if (second.ok) return;
    expect(second.message).toBe("The lever has been pulled a lot from where you are. Give it a while.");
  });
});

