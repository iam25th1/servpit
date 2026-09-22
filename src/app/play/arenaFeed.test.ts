// What a viewer is told when the pit cannot be reached, and how hard the
// client tries to reach it again.
//
// The hook itself needs a browser, so the two rules that matter are pure and
// tested here: how long to wait before opening the stream again, and whether
// there is anything to say yet. The rest of the file is guarded by reading
// it, because the thing that must never happen is a transport error reaching
// the screen, and that is a property of the source rather than of a run.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { feedError, FEED_UNREACHABLE, retryDelayMs, RETRY_BASE_MS, RETRY_MAX_MS } from "./arenaFeed";

describe("waiting before trying the stream again", () => {
  it("starts short, so a blip is over in a second", () => {
    expect(retryDelayMs(0)).toBe(RETRY_BASE_MS);
  });

  it("doubles while it keeps failing", () => {
    expect(retryDelayMs(1)).toBe(RETRY_BASE_MS * 2);
    expect(retryDelayMs(2)).toBe(RETRY_BASE_MS * 4);
  });

  it("stops doubling, so a pit that is down all night is asked every fifteen seconds", () => {
    expect(retryDelayMs(10)).toBe(RETRY_MAX_MS);
    expect(retryDelayMs(1_000)).toBe(RETRY_MAX_MS);
  });
});

describe("what a viewer is told", () => {
  it("says nothing about one failed request, because one happens", () => {
    expect(feedError(0)).toBeNull();
    expect(feedError(1)).toBeNull();
  });

  it("says one plain sentence once it is a pattern", () => {
    expect(feedError(2)).toBe(FEED_UNREACHABLE);
    expect(feedError(50)).toBe(FEED_UNREACHABLE);
  });

  it("is a sentence, not a status line", () => {
    // No code, no url, no verb a viewer would have to look up.
    expect(FEED_UNREACHABLE).not.toMatch(/http|url|fetch|error|[0-9]{3}/i);
    expect(FEED_UNREACHABLE.endsWith(".")).toBe(true);
  });
});

describe("the source itself", () => {
  const source = readFileSync(fileURLToPath(new URL("./arenaFeed.ts", import.meta.url)), "utf8");

  it("never puts a caught error anywhere a viewer could read it", () => {
    // A fetch failure quotes the url it tried, and an operator's url can
    // carry their key. The catch takes no argument at all, which is the only
    // shape that cannot leak one by accident.
    expect(source).not.toMatch(/catch\s*\(/);
    expect(source).not.toMatch(/setError\((?!null\)|FEED_UNREACHABLE\)|feedError)/);
  });

  it("asks the endpoint again as soon as the stream is back", () => {
    // Reconnecting without reloading leaves a viewer on the phase the pit was
    // in when the stream dropped until the next event happens to arrive.
    const open = source.slice(source.indexOf('addEventListener("open"'), source.indexOf('addEventListener("phase"'));
    expect(open).toContain("load()");
  });
});
