import { describe, expect, it } from "vitest";
import { inWords, leverLines } from "./leverNote";
import type { PullView } from "./pullFeed";

const NOW = Date.parse("2026-09-22T12:00:00.000Z");

const view = (over: Partial<PullView> = {}): PullView => ({
  queued: false,
  message: "Pull the lever to start a round.",
  left: 3,
  resetsAt: null,
  willReason: true,
  reasonBlocked: null,
  ...over,
});

const state = (over: Partial<Parameters<typeof leverLines>[0]> = {}) => ({
  view: view(),
  error: null,
  pulling: false,
  busy: false,
  handle: "ash",
  now: NOW,
  ...over,
});

describe("how long until a pull comes back", () => {
  it("counts in minutes, then hours, the way somebody waiting would say it", () => {
    expect(inWords(60_000)).toBe("in 1 minute");
    expect(inWords(10 * 60_000)).toBe("in 10 minutes");
    expect(inWords(60 * 60_000)).toBe("in 1 hour");
    expect(inWords(130 * 60_000)).toBe("in 2 hours 10 minutes");
    expect(inWords(-5)).toBe("any moment");
  });
});

describe("what the lever says", () => {
  it("says how many pulls are left before anybody pulls anything", () => {
    expect(leverLines(state()).pulls).toBe("3 pulls left.");
  });

  it("says when the next one arrives, when the pit told it", () => {
    const at = new Date(NOW + 130 * 60_000).toISOString();
    expect(leverLines(state({ view: view({ left: 1, resetsAt: at }) })).pulls).toBe("1 pull left, one more in 2 hours 10 minutes.");
  });

  it("says whether the round will reason, before it is pulled", () => {
    expect(leverLines(state()).reasoning).toBe("The agents will reason about this round.");
    const blocked = view({ willReason: false, reasonBlocked: "The pit has spent its reasoning budget for today, so this round runs on instinct." });
    expect(leverLines(state({ view: blocked })).reasoning).toMatch(/budget/);
  });

  it("says plainly which thing is in the way", () => {
    const at = new Date(NOW + 60 * 60_000).toISOString();
    expect(leverLines(state({ view: view({ left: 0, resetsAt: at }) })).blocked).toBe("No pulls left, the next in 1 hour.");
    expect(leverLines(state({ busy: true })).blocked).toMatch(/round is running/);
    expect(leverLines(state({ handle: null })).blocked).toMatch(/handle/);
    expect(leverLines(state({ error: "Somebody just pulled it. That round is starting now." })).blocked).toMatch(/just pulled it/);
  });

  it("prefers the pit's own sentence over its own guess", () => {
    // The server says why in words written for a viewer. When it has spoken,
    // that is the line, whatever else might also be true.
    const lines = leverLines(state({ busy: true, error: "The lever has started 6 rounds this hour, which is its limit. The pit keeps playing on its own." }));
    expect(lines.blocked).toMatch(/6 rounds this hour/);
  });

  it("says nothing about limits it has not been told about yet", () => {
    expect(leverLines(state({ view: null })).pulls).toBeNull();
    expect(leverLines(state({ view: null })).reasoning).toBe("");
  });

  it("keeps what the pit said when it took the ask, until the round starts", () => {
    const queued = view({ queued: true, message: "The pit heard you. The agents reason about this one." });
    expect(leverLines(state({ view: queued })).said).toMatch(/heard you/);
    // Once the round is running the sentence has been answered by the round.
    expect(leverLines(state({ view: queued, busy: true })).said).toBeNull();
  });

  it("says it is pulling while it is", () => {
    expect(leverLines(state({ pulling: true })).action).toBe("Pulling");
    expect(leverLines(state()).action).toBe("Pull the lever");
  });

  it("says unlimited rather than a number nobody set", () => {
    expect(leverLines(state({ view: view({ left: null }) })).pulls).toBe("Unlimited pulls.");
    expect(leverLines(state({ view: view({ left: null }) })).blocked).toBeNull();
  });
});
