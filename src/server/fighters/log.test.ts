import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLAIMABLE_FACES } from "@/config/fighters";
import { StoreNetworkMismatch } from "@/server/store/file";
import { FighterStore } from "./log";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const store = (network = "fake", now?: () => number): FighterStore => {
  dir = mkdtempSync(join(tmpdir(), "servpit-fighters-"));
  return new FighterStore(join(dir, `fighters-${network}.ndjson`), network, now);
};

const claim = (log: FighterStore, handle: string, face: string, over: { tokenHash?: string; name?: string; cap?: number } = {}) =>
  log.claim({ handle, tokenHash: over.tokenHash ?? `hash-${handle}`, name: over.name ?? handle, face, cap: over.cap });

describe("claiming a seat", () => {
  it("takes one, and says what it took", () => {
    const log = store();
    const answer = claim(log, "ash", "Monk");
    expect(answer.outcome).toBe("claimed");
    expect(answer.fighter).toMatchObject({ handle: "ash", face: "Monk", entrantId: "fighter-ash" });
    expect(log.fighterOf("ash")?.name).toBe("ash");
  });

  it("gives one handle one fighter", () => {
    const log = store();
    claim(log, "ash", "Monk");
    const again = claim(log, "ash", "Bear");
    expect(again.outcome).toBe("already claimed");
    expect(log.fighterOf("ash")?.face).toBe("Monk");
    expect(log.all()).toHaveLength(1);
  });

  it("keeps a handle on the browser that claimed it", () => {
    const log = store();
    claim(log, "ash", "Monk");
    expect(claim(log, "ash", "Bear", { tokenHash: "another-browser" }).outcome).toBe("handle taken");
  });

  it("never gives one face to two fighters", () => {
    const log = store();
    claim(log, "ash", "Monk");
    expect(claim(log, "bee", "Monk").outcome).toBe("face taken");
    expect(claim(log, "bee", "Bear").outcome).toBe("claimed");
  });

  it("refuses a face that is not one a visitor may take", () => {
    // The originals wear five of them, and a viewer should never have to
    // work out which Knight is Atlas.
    const log = store();
    expect(claim(log, "ash", "Knight").outcome).toBe("face taken");
    expect(claim(log, "ash", "NinjaRed").outcome).toBe("face taken");
  });

  it("says which faces are still free", () => {
    const log = store();
    expect(log.freeFaces()).toEqual([...CLAIMABLE_FACES]);
    claim(log, "ash", "Monk");
    expect(log.freeFaces()).not.toContain("Monk");
    expect(log.freeFaces()).toHaveLength(CLAIMABLE_FACES.length - 1);
  });

  it("holds the cap, so the pit cannot be claimed out from under a newcomer", () => {
    const log = store();
    expect(claim(log, "ash", "Monk", { cap: 2 }).outcome).toBe("claimed");
    expect(claim(log, "bee", "Bear", { cap: 2 }).outcome).toBe("claimed");
    expect(claim(log, "cyd", "Dragon", { cap: 2 }).outcome).toBe("pit full");
  });

  it("gives a seat back, and lets the same handle claim again", () => {
    const log = store();
    claim(log, "ash", "Monk");
    log.release("ash");
    expect(log.fighterOf("ash")).toBeNull();
    expect(log.freeFaces()).toContain("Monk");
    expect(claim(log, "ash", "Monk").outcome).toBe("claimed");
  });

  it("remembers when a fighter's owner was last here", () => {
    let clock = Date.parse("2026-09-23T00:00:00.000Z");
    const log = store("fake", () => clock);
    claim(log, "ash", "Monk");
    const claimedAt = log.fighterOf("ash")!.seenAt;
    clock += 60 * 60_000;
    log.seen("ash");
    expect(log.fighterOf("ash")!.seenAt).toBeGreaterThan(claimedAt);
  });

  it("refuses to read a log from another network", () => {
    const log = store("fake");
    claim(log, "ash", "Monk");
    const other = new FighterStore(join(dir, "fighters-fake.ndjson"), "base-sepolia");
    expect(() => other.all()).toThrow(StoreNetworkMismatch);
  });

  it("reads around a line a crash cut in half", () => {
    const log = store();
    claim(log, "ash", "Monk");
    const file = join(dir, "fighters-fake.ndjson");
    writeFileSync(file, readFileSync(file, "utf8") + '{"k":"claim","handle":"torn"', { flag: "a" });
    expect(log.fighterOf("ash")?.face).toBe("Monk");
  });
});

describe("seats nobody comes back to", () => {
  it("goes back in the pool after the release period, and not before", () => {
    let clock = Date.parse("2026-09-23T00:00:00.000Z");
    const log = store("fake", () => clock);
    claim(log, "ash", "Monk");
    const day = 24 * 60 * 60_000;

    clock += day;
    expect(log.sweep(3 * day)).toEqual([]);
    expect(log.fighterOf("ash")).not.toBeNull();

    clock += 3 * day;
    expect(log.sweep(3 * day)).toEqual(["ash"]);
    expect(log.fighterOf("ash")).toBeNull();
    expect(log.freeFaces()).toContain("Monk");
  });

  it("never takes a seat from somebody who is watching", () => {
    let clock = Date.parse("2026-09-23T00:00:00.000Z");
    const log = store("fake", () => clock);
    claim(log, "ash", "Monk");
    const day = 24 * 60 * 60_000;
    for (let i = 0; i < 5; i += 1) {
      clock += day;
      log.seen("ash");
      expect(log.sweep(2 * day)).toEqual([]);
    }
    expect(log.fighterOf("ash")).not.toBeNull();
  });

  it("lets the same handle claim again after a release", () => {
    let clock = Date.parse("2026-09-23T00:00:00.000Z");
    const log = store("fake", () => clock);
    claim(log, "ash", "Monk");
    clock += 10 * 24 * 60 * 60_000;
    log.sweep(24 * 60 * 60_000);
    expect(claim(log, "ash", "Monk").outcome).toBe("claimed");
  });
});
