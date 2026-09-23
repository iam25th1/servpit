import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FIGHTER_SETTINGS, readFighterSettings, writeFighterSettings } from "./settings";
import { fighterStatusLines, parseFighterCommand } from "./command";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-fighter-settings-"));
  file = join(dir, "fighter-settings.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the operator's seat settings", () => {
  it("are the defaults until somebody writes them", () => {
    expect(readFighterSettings(file)).toEqual(DEFAULT_FIGHTER_SETTINGS);
  });

  it("are read back exactly as written, with no restart in between", () => {
    writeFighterSettings(file, { cap: 5, reserve: 1, releaseHours: 24 });
    expect(readFighterSettings(file)).toEqual({ cap: 5, reserve: 1, releaseHours: 24 });
  });

  it("never lets the reserve swallow the cap", () => {
    // A reserve as big as the pit would be a pit nobody could claim in.
    writeFighterSettings(file, { cap: 3, reserve: 9, releaseHours: 24 });
    expect(readFighterSettings(file).reserve).toBe(2);
  });

  it("falls back to the ordinary limits rather than to none when the file is nonsense", () => {
    writeFileSync(file, "{ not json");
    expect(readFighterSettings(file)).toEqual(DEFAULT_FIGHTER_SETTINGS);
  });

  it("ignores a value that is not a whole number in range", () => {
    writeFileSync(file, JSON.stringify({ cap: 0, reserve: -1, releaseHours: "ages" }));
    expect(readFighterSettings(file)).toEqual(DEFAULT_FIGHTER_SETTINGS);
  });
});

describe("what the operator asked for", () => {
  it("reads nothing as a request to see where things stand", () => {
    expect(parseFighterCommand([])).toEqual({ kind: "status" });
    expect(parseFighterCommand(["status"])).toEqual({ kind: "status" });
  });

  it("sets each limit on its own", () => {
    expect(parseFighterCommand(["cap", "6"])).toEqual({ kind: "set", settings: { cap: 6 } });
    expect(parseFighterCommand(["reserve", "3"])).toEqual({ kind: "set", settings: { reserve: 3 } });
    expect(parseFighterCommand(["release-hours", "48"])).toEqual({ kind: "set", settings: { releaseHours: 48 } });
  });

  it("refuses a value that is not a whole number in range, rather than writing it", () => {
    expect(() => parseFighterCommand(["cap", "0"])).toThrow(RangeError);
    expect(() => parseFighterCommand(["release-hours", "2.5"])).toThrow(RangeError);
    expect(() => parseFighterCommand(["reserve"])).toThrow(RangeError);
    expect(() => parseFighterCommand(["seats", "9"])).toThrow(RangeError);
  });
});

describe("the seat status", () => {
  it("says what is claimed, what is free and what the rules are", () => {
    const out = fighterStatusLines({
      settings: { cap: 8, reserve: 2, releaseHours: 72 },
      claimed: 3,
      freeFaces: 8,
      released: [],
      fighters: [{ handle: "ash", name: "Cinder", face: "Monk", hoursSinceSeen: 2 }],
    }).join("\n");
    expect(out).toContain("3 claimed of 8");
    expect(out).toContain("2 kept for somebody new");
    expect(out).toContain("released after 72 hours without a visit");
    expect(out).toContain("Cinder (ash, Monk), last here 2 hours ago");
  });

  it("names the seats it just gave back", () => {
    const out = fighterStatusLines({
      settings: { cap: 8, reserve: 2, releaseHours: 72 },
      claimed: 0,
      freeFaces: 11,
      released: ["ash", "bee"],
      fighters: [],
    }).join("\n");
    expect(out).toContain("released just now: ash, bee");
    expect(out).toContain("nobody has claimed a seat");
  });
});
