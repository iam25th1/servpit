import { describe, expect, it } from "vitest";
import type { CareerRow } from "./careerStore";
import { fighterBoardPage, fighterBoardRow, fighterBoardRows } from "./board";

const record = (handle: string, over: Partial<CareerRow> = {}): CareerRow => ({
  handle,
  name: handle.toUpperCase(),
  face: "Monk",
  rounds: 3,
  wins: 0,
  best: 5,
  kills: 1,
  streak: 0,
  longest: 1,
  ...over,
});

describe("the fighters board", () => {
  it("lists a fighter the moment it is claimed, before it has fought", () => {
    // The reported bug: a claim landed, the board said nobody had claimed one.
    const page = fighterBoardPage([], [{ handle: "cupcake", name: "cupcake", face: "Samurai" }], 1, 10);
    expect(page.total).toBe(1);
    expect(page.claimed).toBe(1);
    expect(page.rows[0]).toMatchObject({ handle: "cupcake", name: "cupcake", face: "Samurai", rounds: 0, wins: 0, inPit: true });
  });

  it("keeps a record whose seat has gone back, and says it is out of the pit", () => {
    const rows = fighterBoardRows([record("ash", { wins: 2 })], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ handle: "ash", wins: 2, inPit: false });
  });

  it("does not list a claimed fighter twice once it has a record", () => {
    const rows = fighterBoardRows([record("ash")], [{ handle: "ash", name: "Cinder", face: "Knight" }]);
    expect(rows).toHaveLength(1);
    // The name and face the seat carries now.
    expect(rows[0]).toMatchObject({ handle: "ash", name: "Cinder", face: "Knight", inPit: true, rounds: 3 });
  });

  it("ranks everybody who has fought ahead of the fighters still waiting for a first round", () => {
    const rows = fighterBoardRows([record("ash", { wins: 1 }), record("bo")], [{ handle: "new", name: "new", face: "Monk" }, { handle: "ash", name: "ash", face: "Monk" }]);
    expect(rows.map((r) => r.handle)).toEqual(["ash", "bo", "new"]);
  });

  it("pages the merged list and clamps the page", () => {
    const claims = Array.from({ length: 12 }, (_, i) => ({ handle: `f${i}`, name: `F${i}`, face: "Monk" }));
    const first = fighterBoardPage([], claims, 1, 10);
    expect(first.rows).toHaveLength(10);
    expect(first.pages).toBe(2);
    expect(fighterBoardPage([], claims, 9, 10).page).toBe(2);
    expect(fighterBoardPage([], claims, Number.NaN, 10).page).toBe(1);
  });

  it("finds one handle's row whether it has a record, a seat, or both", () => {
    expect(fighterBoardRow([], [{ handle: "cupcake", name: "cupcake", face: "Samurai" }], "cupcake")?.inPit).toBe(true);
    expect(fighterBoardRow([record("ash")], [], "ash")?.inPit).toBe(false);
    expect(fighterBoardRow([], [], "nobody")).toBeNull();
  });
});
