import { describe, expect, it } from "vitest";
import { POINTS_PER_ROUND } from "@/config/backing";
import { pointsFor, scoreRound } from "./score";

const picks = (pairs: Record<string, string>): Map<string, string> => new Map(Object.entries(pairs));

describe("what a correct pick is worth", () => {
  it("pays the base when everybody backed the winner", () => {
    expect(pointsFor(10, 10)).toBe(POINTS_PER_ROUND);
  });

  it("pays more the fewer people shared the call", () => {
    expect(pointsFor(10, 5)).toBe(POINTS_PER_ROUND * 2);
    expect(pointsFor(10, 2)).toBe(POINTS_PER_ROUND * 5);
    expect(pointsFor(10, 1)).toBe(POINTS_PER_ROUND * 10);
  });

  it("is whole points, rounded down, so two backers cannot be paid a fraction each", () => {
    expect(pointsFor(10, 3)).toBe(333);
    expect(pointsFor(7, 2)).toBe(350);
    expect(Number.isInteger(pointsFor(97, 13))).toBe(true);
  });

  it("is nothing when nobody called it", () => {
    expect(pointsFor(10, 0)).toBe(0);
    expect(pointsFor(0, 0)).toBe(0);
  });
});

describe("scoring a round", () => {
  it("pays the backers who were right and nobody else", () => {
    const scores = scoreRound(picks({ ash: "atlas", bowen: "atlas", cyan: "vex" }), "agent-atlas");
    expect(scores).toEqual([
      { handle: "ash", agentId: "atlas", correct: true, points: 150 },
      { handle: "bowen", agentId: "atlas", correct: true, points: 150 },
      { handle: "cyan", agentId: "vex", correct: false, points: 0 },
    ]);
  });

  it("pays the lone caller of a long shot the whole field", () => {
    const field = picks({ ash: "atlas", bowen: "atlas", cyan: "atlas", dax: "vex" });
    const scores = scoreRound(field, "agent-vex");
    expect(scores.find((s) => s.handle === "dax")).toEqual({ handle: "dax", agentId: "vex", correct: true, points: 400 });
    for (const s of scores.filter((s) => s.handle !== "dax")) expect(s.points).toBe(0);
  });

  it("pays nothing at all when a house bot wins, which nobody can back", () => {
    const scores = scoreRound(picks({ ash: "atlas", bowen: "vex" }), "bot-07");
    expect(scores.every((s) => s.points === 0 && !s.correct)).toBe(true);
  });

  it("is the same answer every time it is asked", () => {
    const field = picks({ ash: "atlas", bowen: "vex", cyan: "atlas", dax: "flint" });
    expect(scoreRound(field, "agent-atlas")).toEqual(scoreRound(field, "agent-atlas"));
  });

  it("has nothing to say about a round nobody backed", () => {
    expect(scoreRound(picks({}), "agent-atlas")).toEqual([]);
  });

  it("reads the winner as the entrant it is, not as an agent id", () => {
    // The pit records a winner as an entrant, and entrants that are agents are
    // the agent id with a prefix. A pick is the agent id.
    expect(scoreRound(picks({ ash: "atlas" }), "agent-atlas")[0]!.correct).toBe(true);
    expect(scoreRound(picks({ ash: "atlas" }), "atlas")[0]!.correct).toBe(false);
  });
});
