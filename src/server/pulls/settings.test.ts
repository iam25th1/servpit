import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PULL_SETTINGS, readPullSettings, writePullSettings } from "./settings";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-pull-settings-"));
  file = join(dir, "pull-settings.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the operator's limits", () => {
  it("are the defaults until somebody writes them", () => {
    expect(readPullSettings(file)).toEqual(DEFAULT_PULL_SETTINGS);
  });

  it("are read back exactly as written, with no restart in between", () => {
    writePullSettings(file, { perIdentity: 5, windowHours: 2, dailyBudgetCents: 40, perHour: 10 });
    expect(readPullSettings(file)).toEqual({ perIdentity: 5, windowHours: 2, dailyBudgetCents: 40, perHour: 10 });
  });

  it("keep unlimited as a setting, rather than as a very large number", () => {
    writePullSettings(file, { ...DEFAULT_PULL_SETTINGS, perIdentity: null });
    expect(readPullSettings(file).perIdentity).toBeNull();
  });

  it("fall back to the defaults rather than to no limits when the file is nonsense", () => {
    // The failure mode of a corrupt settings file has to be the tight end.
    writeFileSync(file, "{ this is not json");
    expect(readPullSettings(file)).toEqual(DEFAULT_PULL_SETTINGS);
  });

  it("ignore a value that is not a whole number in range", () => {
    writeFileSync(file, JSON.stringify({ perIdentity: -4, windowHours: 0, dailyBudgetCents: "lots", perHour: 2.5 }));
    expect(readPullSettings(file)).toEqual(DEFAULT_PULL_SETTINGS);
  });

  it("allows a budget of nothing, which is a pit that never reasons", () => {
    writePullSettings(file, { ...DEFAULT_PULL_SETTINGS, dailyBudgetCents: 0 });
    expect(readPullSettings(file).dailyBudgetCents).toBe(0);
  });
});
