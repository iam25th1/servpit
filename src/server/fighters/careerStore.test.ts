import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FighterRound } from "./career";
import { CareerStore } from "./careerStore";

let dir: string;
let store: CareerStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-careers-"));
  store = new CareerStore(join(dir, "careers-fake.json"), "fake");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const named = new Map([
  ["ash", { name: "Cinder", face: "Monk" }],
  ["bee", { name: "Bee", face: "Bear" }],
]);

const round = (over: Partial<FighterRound> = {}): FighterRound => ({
  handle: "ash",
  entrantId: "fighter-ash",
  placement: 4,
  kills: 1,
  won: false,
  outlasted: true,
  ...over,
});

describe("a fighter's record", () => {
  it("adds up rounds, wins, kills and the best placement", () => {
    store.apply("r-1", [round({ placement: 4, kills: 1 })], named);
    store.apply("r-2", [round({ placement: 1, kills: 3, won: true })], named);
    expect(store.row("ash")).toMatchObject({ name: "Cinder", face: "Monk", rounds: 2, wins: 1, best: 1, kills: 4 });
  });

  it("keeps the best placement rather than the last one", () => {
    store.apply("r-1", [round({ placement: 2 })], named);
    store.apply("r-2", [round({ placement: 19 })], named);
    expect(store.row("ash")?.best).toBe(2);
  });

  it("runs a streak of outlasting the field, and remembers the longest", () => {
    store.apply("r-1", [round({ outlasted: true })], named);
    store.apply("r-2", [round({ outlasted: true })], named);
    expect(store.row("ash")).toMatchObject({ streak: 2, longest: 2 });
    store.apply("r-3", [round({ outlasted: false })], named);
    expect(store.row("ash")).toMatchObject({ streak: 0, longest: 2 });
    store.apply("r-4", [round({ outlasted: true })], named);
    expect(store.row("ash")).toMatchObject({ streak: 1, longest: 2 });
  });

  it("counts a round once, however many times the settle runs", () => {
    // A worker that crashes between the result and the settle runs the settle
    // again when it comes back, and the record must not double.
    expect(store.apply("r-1", [round()], named)).toBe(true);
    expect(store.apply("r-1", [round()], named)).toBe(false);
    expect(store.row("ash")?.rounds).toBe(1);
  });

  it("keeps the record under the handle, so a reclaimed seat carries on", () => {
    store.apply("r-1", [round({ kills: 2 })], named);
    // The seat was released and claimed again, with a new name and face.
    store.apply("r-2", [round({ kills: 1 })], new Map([["ash", { name: "Ember", face: "Bear" }]]));
    expect(store.row("ash")).toMatchObject({ rounds: 2, kills: 3, name: "Ember", face: "Bear" });
  });

  it("orders the board by wins, then the best placement, then kills", () => {
    store.apply("r-1", [round({ handle: "ash", won: true, placement: 1, kills: 0 })], named);
    store.apply("r-2", [round({ handle: "bee", placement: 2, kills: 9 })], named);
    expect(store.rows().map((r) => r.handle)).toEqual(["ash", "bee"]);
  });

  it("pages, so a board of hundreds is still a screenful", () => {
    for (let i = 0; i < 25; i += 1) {
      store.apply(`r-${i}`, [round({ handle: `h${i}` })], new Map([[`h${i}`, { name: `F${i}`, face: "Monk" }]]));
    }
    const page = store.page(2, 10);
    expect(page).toMatchObject({ page: 2, pages: 3, total: 25 });
    expect(page.rows).toHaveLength(10);
    // Past the end lands on the last page rather than on nothing.
    expect(store.page(99, 10).page).toBe(3);
  });

  it("says nothing about a handle with no record", () => {
    expect(store.row("nobody")).toBeNull();
  });
});
