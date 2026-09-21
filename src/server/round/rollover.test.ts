import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RolloverStore } from "./rollover";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const store = (): RolloverStore => {
  dir = mkdtempSync(join(tmpdir(), "servpit-rollover-"));
  return new RolloverStore(join(dir, "rollover.json"));
};

describe("RolloverStore", () => {
  it("starts empty, so the first round's prize is exactly what agents paid in", () => {
    const s = store();
    expect(s.carriedWei).toBe(0n);
    expect(s.inputFor("r-1")).toBe(0n);
  });

  it("carries what a round left into the next round", () => {
    const s = store();
    s.record("r-1", 0n, 500n);
    expect(s.carriedWei).toBe(500n);
    expect(s.inputFor("r-2")).toBe(500n);
  });

  it("gives a replay of a settled round the rollover it consumed, not the one it produced", () => {
    // Settling is idempotent by round id, so reading the rollover has to be.
    // Reading the running total here would hand the replay its own output and
    // pay a different number the second time.
    const s = store();
    s.record("r-1", 0n, 500n);
    s.record("r-2", 500n, 900n);
    expect(s.inputFor("r-2")).toBe(500n);
    s.record("r-2", 500n, 900n);
    expect(s.carriedWei).toBe(900n);
  });

  it("refuses to record a different input for a round it already recorded", () => {
    const s = store();
    s.record("r-1", 0n, 500n);
    expect(() => s.record("r-1", 300n, 800n)).toThrow(/already consumed/);
  });

  it("survives a restart", () => {
    const s = store();
    s.record("r-1", 0n, 500n);
    const file = join(dir, "rollover.json");
    const reopened = new RolloverStore(file);
    expect(reopened.carriedWei).toBe(500n);
    expect(reopened.inputFor("r-1")).toBe(0n);
    expect(JSON.parse(readFileSync(file, "utf8")).rolloverWei).toBe("500");
  });

  it("refuses a negative or non bigint amount", () => {
    const s = store();
    expect(() => s.record("r-1", 0n, -1n)).toThrow();
    expect(() => s.record("r-1", 0n, 500 as unknown as bigint)).toThrow();
  });
});
