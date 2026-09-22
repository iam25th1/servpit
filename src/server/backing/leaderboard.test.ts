import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LeaderboardStore } from "./leaderboard";
import type { RoundScore } from "./score";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-board-"));
  file = join(dir, "leaderboard-fake.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const board = (): LeaderboardStore => new LeaderboardStore(file, "fake");
const score = (handle: string, correct: boolean, points: number): RoundScore => ({ handle, agentId: "atlas", correct, points });

describe("the board", () => {
  it("records what a round did to everybody who backed it", () => {
    const b = board();
    b.apply("r-1", [score("ash", true, 200), score("bowen", false, 0)]);
    expect(b.rows()).toEqual([
      { handle: "ash", points: 200, picks: 1, correct: 1, streak: 1, best: 1 },
      { handle: "bowen", points: 0, picks: 1, correct: 0, streak: 0, best: 0 },
    ]);
  });

  it("adds rounds up, and keeps the best first", () => {
    const b = board();
    b.apply("r-1", [score("ash", true, 100), score("bowen", false, 0)]);
    b.apply("r-2", [score("ash", false, 0), score("bowen", true, 400)]);
    expect(b.rows().map((r) => r.handle)).toEqual(["bowen", "ash"]);
    expect(b.row("bowen")).toMatchObject({ points: 400, picks: 2, correct: 1 });
  });

  it("counts a streak, ends it on a wrong call and remembers the best one", () => {
    const b = board();
    b.apply("r-1", [score("ash", true, 100)]);
    b.apply("r-2", [score("ash", true, 100)]);
    expect(b.row("ash")).toMatchObject({ streak: 2, best: 2 });
    b.apply("r-3", [score("ash", false, 0)]);
    expect(b.row("ash")).toMatchObject({ streak: 0, best: 2 });
    b.apply("r-4", [score("ash", true, 100)]);
    expect(b.row("ash")).toMatchObject({ streak: 1, best: 2 });
  });

  it("scores a round once, however many times the settle runs", () => {
    const b = board();
    expect(b.apply("r-1", [score("ash", true, 100)])).toBe(true);
    expect(b.apply("r-1", [score("ash", true, 100)])).toBe(false);
    expect(b.row("ash")).toMatchObject({ points: 100, picks: 1 });
    expect(b.has("r-1")).toBe(true);
  });

  it("survives a restart, which is what a file is for", () => {
    board().apply("r-1", [score("ash", true, 100)]);
    const reopened = board();
    expect(reopened.row("ash")).toMatchObject({ points: 100 });
    expect(reopened.apply("r-1", [score("ash", true, 100)])).toBe(false);
  });

  it("pages, so a board of hundreds is a screen of ten", () => {
    const b = board();
    b.apply(
      "r-1",
      Array.from({ length: 25 }, (_, i) => score(`backer-${String(i).padStart(2, "0")}`, true, 100 + i)),
    );
    const first = b.page(1, 10);
    expect(first).toMatchObject({ page: 1, pages: 3, total: 25 });
    expect(first.rows).toHaveLength(10);
    expect(first.rows[0]!.points).toBe(124);
    expect(b.page(3, 10).rows).toHaveLength(5);
    // A page past the end is the last one rather than an empty screen.
    expect(b.page(99, 10).page).toBe(3);
    expect(b.page(0, 10).page).toBe(1);
  });

  it("has nothing to say before anybody has backed anything", () => {
    expect(board().rows()).toEqual([]);
    expect(board().page(1, 10)).toMatchObject({ rows: [], page: 1, pages: 1, total: 0 });
    expect(board().row("ash")).toBeNull();
  });
});
