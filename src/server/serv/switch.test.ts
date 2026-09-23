import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scheduledReasoningOn, servReasoningOn, setScheduledReasoning, setServReasoning } from "./switch";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-switch-"));
  file = join(dir, "serv-off");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the reasoning switch", () => {
  it("is on until somebody turns it off, so nothing changes by installing it", () => {
    expect(servReasoningOn(file)).toBe(true);
  });

  it("is off while the file is there", () => {
    setServReasoning(file, false);
    expect(existsSync(file)).toBe(true);
    expect(servReasoningOn(file)).toBe(false);
  });

  it("comes back on when the file goes", () => {
    setServReasoning(file, false);
    setServReasoning(file, true);
    expect(existsSync(file)).toBe(false);
    expect(servReasoningOn(file)).toBe(true);
  });

  it("turns on an already on switch without complaining", () => {
    expect(setServReasoning(file, true)).toBe(true);
    expect(servReasoningOn(file)).toBe(true);
  });

  it("makes the directory if the data directory is not there yet", () => {
    const deeper = join(dir, "nested", "serv-off");
    setServReasoning(deeper, false);
    expect(servReasoningOn(deeper)).toBe(false);
  });

  it("is on for a context that has no switch at all", () => {
    // A test harness, or any caller built before the switch existed.
    expect(servReasoningOn(undefined)).toBe(true);
  });
});

describe("whether a scheduled round reasons", () => {
  it("is off until somebody turns it on, because a pit plays itself all day", () => {
    const dir = mkdtempSync(join(tmpdir(), "servpit-scheduled-"));
    try {
      const file = join(dir, "serv-scheduled");
      expect(scheduledReasoningOn(file)).toBe(false);
      expect(setScheduledReasoning(file, true)).toBe(true);
      expect(scheduledReasoningOn(file)).toBe(true);
      expect(setScheduledReasoning(file, false)).toBe(false);
      expect(scheduledReasoningOn(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is off for a context that has no setting at all", () => {
    expect(scheduledReasoningOn(undefined)).toBe(false);
  });
});
