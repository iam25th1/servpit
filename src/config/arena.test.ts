import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ROUND_INTERVAL_SECONDS, MAX_ROUND_INTERVAL_SECONDS, MIN_ROUND_INTERVAL_SECONDS, PAUSE_FILE, arenaMode, roundIntervalSeconds } from "./arena";

/** The same shape a route reads, without pretending to be the real one. */
const env = (v: Record<string, string> = {}): NodeJS.ProcessEnv => v as NodeJS.ProcessEnv;

afterEach(() => {
  delete process.env.SERVPIT_ARENA_MODE;
  delete process.env.SERVPIT_ROUND_INTERVAL_SECONDS;
});

describe("arena mode", () => {
  it("is off unless somebody turns it on", () => {
    expect(arenaMode(env({}))).toBe(false);
    expect(arenaMode(env({ SERVPIT_ARENA_MODE: "" }))).toBe(false);
    expect(arenaMode(env({ SERVPIT_ARENA_MODE: "false" }))).toBe(false);
    expect(arenaMode(env({ SERVPIT_ARENA_MODE: "0" }))).toBe(false);
  });

  it("is on when it is set", () => {
    expect(arenaMode(env({ SERVPIT_ARENA_MODE: "true" }))).toBe(true);
    expect(arenaMode(env({ SERVPIT_ARENA_MODE: "TRUE" }))).toBe(true);
    expect(arenaMode(env({ SERVPIT_ARENA_MODE: "1" }))).toBe(true);
  });

  it("refuses a value that is neither, rather than guessing", () => {
    expect(() => arenaMode(env({ SERVPIT_ARENA_MODE: "maybe" }))).toThrow(/must be true or false/);
  });
});

describe("the interval", () => {
  it("is an hour unless somebody says otherwise", () => {
    expect(roundIntervalSeconds(env({}))).toBe(DEFAULT_ROUND_INTERVAL_SECONDS);
    expect(DEFAULT_ROUND_INTERVAL_SECONDS).toBe(3_600);
  });

  it("takes a whole number of seconds inside its bounds", () => {
    expect(roundIntervalSeconds(env({ SERVPIT_ROUND_INTERVAL_SECONDS: "600" }))).toBe(600);
    expect(roundIntervalSeconds(env({ SERVPIT_ROUND_INTERVAL_SECONDS: String(MIN_ROUND_INTERVAL_SECONDS) }))).toBe(MIN_ROUND_INTERVAL_SECONDS);
    expect(roundIntervalSeconds(env({ SERVPIT_ROUND_INTERVAL_SECONDS: String(MAX_ROUND_INTERVAL_SECONDS) }))).toBe(MAX_ROUND_INTERVAL_SECONDS);
  });

  it("refuses an interval shorter than a round or longer than a day", () => {
    expect(() => roundIntervalSeconds(env({ SERVPIT_ROUND_INTERVAL_SECONDS: "1" }))).toThrow(/between/);
    expect(() => roundIntervalSeconds(env({ SERVPIT_ROUND_INTERVAL_SECONDS: String(MAX_ROUND_INTERVAL_SECONDS + 1) }))).toThrow(/between/);
    expect(() => roundIntervalSeconds(env({ SERVPIT_ROUND_INTERVAL_SECONDS: "3.5" }))).toThrow(/whole number/);
    expect(() => roundIntervalSeconds(env({ SERVPIT_ROUND_INTERVAL_SECONDS: "soon" }))).toThrow(/whole number/);
  });
});

describe("the pause file", () => {
  it("is a file, because a running process never rereads its environment", () => {
    expect(PAUSE_FILE).toBe("arena-paused");
  });
});
