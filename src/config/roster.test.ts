import { describe, expect, it } from "vitest";
import { ROSTER, type RosterEntry, type Tier } from "./roster";

const byTier = (t: Tier): RosterEntry[] => ROSTER.filter((e) => e.tier === t);

describe("roster", () => {
  it("has 16 entries split 8 common, 5 uncommon, 3 rare", () => {
    expect(ROSTER).toHaveLength(16);
    expect(byTier("common")).toHaveLength(8);
    expect(byTier("uncommon")).toHaveLength(5);
    expect(byTier("rare")).toHaveLength(3);
  });

  it("ids are unique and safe path segments", () => {
    const ids = ROSTER.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("rare entries live under Actor/Monster and the rest under Actor/Character", () => {
    for (const e of ROSTER) {
      const expected = e.tier === "rare" ? "Actor/Monster/" : "Actor/Character/";
      expect(e.sourceFolder.startsWith(expected), e.id).toBe(true);
      expect(e.sourceFolder.endsWith("/" + e.id)).toBe(true);
    }
  });

  it("matches the locked names", () => {
    expect(byTier("common").map((e) => e.id)).toEqual([
      "NinjaRed", "NinjaBlue", "Knight", "Monk", "Hunter", "Boy", "Eskimo", "Caveman",
    ]);
    expect(byTier("uncommon").map((e) => e.id)).toEqual([
      "NinjaDark", "NinjaFire", "NinjaWater", "KnightGold", "GladiatorBlue",
    ]);
    expect(byTier("rare").map((e) => e.id)).toEqual(["Dragon", "Cyclope", "Bear"]);
  });
});
