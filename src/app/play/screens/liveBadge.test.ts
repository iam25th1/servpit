import { describe, expect, it } from "vitest";
import { liveBadge, type BadgeState } from "./liveBadge";

const watching = (over: Partial<BadgeState> = {}): BadgeState => ({
  live: true,
  error: null,
  resting: false,
  paused: false,
  replay: false,
  ...over,
});

describe("liveBadge", () => {
  it("says watching live only while a round is actually running", () => {
    expect(liveBadge(watching())).toEqual({ text: "watching live", tone: "live" });
  });

  it("says the pit is paused while it is paused", () => {
    // The badge read watching live over a stopped pit, which is a claim about
    // a money surface that was not true. The stream being up is not the same
    // as the pit running.
    expect(liveBadge(watching({ paused: true, resting: true }))).toEqual({ text: "the pit is paused", tone: "waiting" });
  });

  it("says between rounds while the pit rests", () => {
    expect(liveBadge(watching({ resting: true }))).toEqual({ text: "between rounds", tone: "waiting" });
  });

  it("puts a replay above everything, because a recording is not the pit", () => {
    expect(liveBadge(watching({ replay: true, paused: true, resting: true }))).toEqual({
      text: "replay of a finished round",
      tone: "replay",
    });
  });

  it("says what went wrong before it says anything else about the pit", () => {
    expect(liveBadge(watching({ error: "the pit is out of reach", resting: true }))).toEqual({
      text: "the pit is out of reach",
      tone: "offair",
    });
  });

  it("says reconnecting when the stream is down, whatever the pit was doing", () => {
    expect(liveBadge(watching({ live: false, resting: true }))).toEqual({ text: "reconnecting", tone: "offair" });
  });

  it("never claims a round is running when one is not", () => {
    for (const state of [
      watching({ paused: true }),
      watching({ resting: true }),
      watching({ paused: true, resting: true }),
      watching({ live: false }),
      watching({ error: "gone" }),
      watching({ replay: true }),
    ]) {
      expect(liveBadge(state).text).not.toBe("watching live");
    }
  });
});
