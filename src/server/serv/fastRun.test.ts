// The stop rules, the budget and cap arithmetic, and putting things back.

import { describe, expect, it, vi } from "vitest";
import { FALLBACK_ROUND_MS, MAX_BUDGET_CENTS, MEASURE_AFTER, REASONED_DECIDE_MS, Restorer, budgetCentsFor, expectedRoundMs, projectMs, runFast, saidAs, secondsPerRound, workMsOf, type FastRow } from "./fastRun";

describe("pace", () => {
  it("averages the rounds it has played and projects the rest", () => {
    expect(secondsPerRound(2, 120_000)).toBe(60);
    expect(projectMs(2, 120_000, 10)).toBe(600_000);
    // Nothing played is nothing to project from, rather than a zero.
    expect(secondsPerRound(0, 0)).toBeNull();
    expect(projectMs(0, 0, 10)).toBeNull();
  });

  it("says a length the way a person would", () => {
    expect(saidAs(45_000)).toBe("45 s");
    expect(saidAs(20 * 60_000)).toBe("20.0 min");
    expect(saidAs(4.5 * 3_600_000)).toBe("4.5 hours");
  });
});

describe("what a round should take, before one has been played", () => {
  const phases = [
    { phase: "planning", at: "2026-10-13T00:00:00.000Z" },
    { phase: "deciding", at: "2026-10-13T00:00:01.000Z" },
    { phase: "settling", at: "2026-10-13T00:00:04.000Z" },
    { phase: "reels", at: "2026-10-13T00:00:07.300Z" },
    { phase: "backing", at: "2026-10-13T00:00:13.300Z" },
  ];

  it("reads the work out of the phase marks, which is everything before the show", () => {
    expect(workMsOf(phases)).toBe(7_300);
    expect(workMsOf(undefined)).toBeNull();
    expect(workMsOf([{ phase: "planning", at: "nonsense" }, { phase: "reels", at: "2026-10-13T00:00:07.300Z" }])).toBeNull();
    // A reels mark before its planning mark is not a length.
    expect(workMsOf([{ phase: "planning", at: "2026-10-13T00:00:07.300Z" }, { phase: "reels", at: "2026-10-13T00:00:00.000Z" }])).toBeNull();
  });

  it("adds the measured decision phase when the round it measured ran on instinct", () => {
    expect(expectedRoundMs({ workMs: 7_300, reasoned: false })).toBe(7_300 + REASONED_DECIDE_MS);
    expect(expectedRoundMs({ workMs: 19_300, reasoned: true })).toBe(19_300);
  });

  it("falls back when there is nothing on file to measure", () => {
    expect(expectedRoundMs({ workMs: null, reasoned: true })).toBe(FALLBACK_ROUND_MS);
  });
});

describe("the budget a run needs", () => {
  it("covers what today has spent plus the run's cap, with a cent of headroom", () => {
    // 10 cents spent, a 50 cent cap, so 60 cents plus one.
    expect(budgetCentsFor({ spentTodayMicroCents: 10_000_000, capMicroCents: 50_000_000, currentCents: 25 })).toBe(61);
  });

  it("never lowers a budget that is already higher", () => {
    expect(budgetCentsFor({ spentTodayMicroCents: 0, capMicroCents: 1_000_000, currentCents: 500 })).toBe(500);
  });

  it("stays inside what the settings file will accept", () => {
    expect(budgetCentsFor({ spentTodayMicroCents: 0, capMicroCents: 99_999_999 * 1_000_000, currentCents: 25 })).toBe(MAX_BUDGET_CENTS);
  });

  it("treats a negative reading as nothing spent rather than as credit", () => {
    expect(budgetCentsFor({ spentTodayMicroCents: -5_000_000, capMicroCents: 2_000_000, currentCents: 0 })).toBe(3);
  });
});

describe("putting everything back", () => {
  it("runs every undo, newest first", () => {
    const order: string[] = [];
    const restorer = new Restorer();
    restorer.add("budget", () => order.push("budget"));
    restorer.add("switch", () => order.push("switch"));
    restorer.add("pause", () => order.push("pause"));

    expect(restorer.restore().map((r) => r.name)).toEqual(["pause", "switch", "budget"]);
    expect(order).toEqual(["pause", "switch", "budget"]);
  });

  it("keeps going when one of them throws, and says which failed", () => {
    const done: string[] = [];
    const restorer = new Restorer();
    restorer.add("budget", () => done.push("budget"));
    restorer.add("switch", () => {
      throw new Error("EACCES: permission denied");
    });
    restorer.add("pause", () => done.push("pause"));

    const out = restorer.restore();
    expect(done).toEqual(["pause", "budget"]);
    expect(out.find((r) => r.name === "switch")?.error).toContain("EACCES");
    expect(out.filter((r) => r.error === null).map((r) => r.name)).toEqual(["pause", "budget"]);
  });

  it("only ever restores once, however many times it is asked", () => {
    const undo = vi.fn();
    const restorer = new Restorer();
    restorer.add("budget", undo);
    expect(restorer.pending).toBe(1);
    restorer.restore();
    expect(restorer.restore()).toEqual([]);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(restorer.pending).toBe(0);
  });
});

/** A run that plays rounds on command, with whatever each one recorded. */
const harness = (rows: ReadonlyArray<{ reasoned: boolean; calls?: number; microCents?: number } | null>, over: Partial<Parameters<typeof runFast>[0]> = {}) => {
  const played: string[] = [];
  const lines: FastRow[] = [];
  let at = 0;
  return {
    played,
    lines,
    run: () =>
      runFast({
        need: 3,
        capMicroCents: 10_000_000,
        play: async () => {
          const id = `r-${played.length}`;
          played.push(id);
          at += 60_000;
          return id;
        },
        read: (roundId) => {
          const row = rows[Number(roundId.slice(2))];
          return row === null || row === undefined ? null : { reasoned: row.reasoned, calls: row.calls ?? 6, microCents: row.microCents ?? 2_000_000 };
        },
        onRound: (row) => lines.push(row),
        now: () => at,
        ...over,
      }),
  };
};

describe("a fast run", () => {
  it("stops at the target, counting what the rounds recorded", async () => {
    const h = harness([{ reasoned: true }, { reasoned: true }, { reasoned: true }, { reasoned: true }]);
    const result = await h.run();
    expect(result).toMatchObject({ played: 3, reasoned: 3, why: "target", calls: 18, spentMicroCents: 6_000_000 });
    expect(h.lines.map((l) => l.reasonedSoFar)).toEqual([1, 2, 3]);
  });

  it("does not count a round that came back on instinct", async () => {
    const h = harness([{ reasoned: true }, { reasoned: false }, { reasoned: true }, { reasoned: true }]);
    const result = await h.run();
    expect(result).toMatchObject({ played: 4, reasoned: 3, why: "target" });
    expect(h.lines[1]).toMatchObject({ reasoned: false, reasonedSoFar: 1 });
  });

  it("gives up after three unreasoned rounds in a row", async () => {
    const h = harness([{ reasoned: false }, { reasoned: false }, { reasoned: false }, { reasoned: true }]);
    const result = await h.run();
    expect(result).toMatchObject({ played: 3, reasoned: 0, why: "unreasoned" });
  });

  it("stops at the spend cap, on what the rounds actually cost", async () => {
    const h = harness([{ reasoned: true, microCents: 4_000_000 }, { reasoned: true, microCents: 7_000_000 }, { reasoned: true }], { need: 10 });
    const result = await h.run();
    expect(result).toMatchObject({ played: 2, reasoned: 2, why: "cap", spentMicroCents: 11_000_000 });
  });

  it("counts a round it cannot read as unreasoned and costing nothing", async () => {
    const h = harness([null, null, null]);
    const result = await h.run();
    expect(result).toMatchObject({ played: 3, reasoned: 0, spentMicroCents: 0, why: "unreasoned" });
  });

  it("stops between rounds when a signal says to", async () => {
    let keep = true;
    const h = harness([{ reasoned: true }, { reasoned: true }, { reasoned: true }], {
      need: 10,
      onRound: () => {
        keep = false;
      },
      running: () => keep,
    });
    const result = await h.run();
    expect(result).toMatchObject({ played: 1, reasoned: 1, why: "stopped" });
  });

  it("asks once when the projection is over the time budget, and stops on no", async () => {
    const asked: Array<[number, number]> = [];
    const h = harness(Array.from({ length: 20 }, () => ({ reasoned: true })), {
      need: 20,
      capMicroCents: 1_000_000_000,
      timeBudgetMs: 5 * 60_000,
      overTime: async (projected, per) => {
        asked.push([projected, per]);
        return false;
      },
    });
    const result = await h.run();
    // Two rounds at a minute each, eighteen to go, so eighteen minutes
    // against a five minute budget.
    expect(asked).toEqual([[18 * 60_000, 60]]);
    expect(result).toMatchObject({ played: MEASURE_AFTER, why: "time" });
  });

  it("asks only once when the answer is yes", async () => {
    let asks = 0;
    const h = harness(Array.from({ length: 6 }, () => ({ reasoned: true })), {
      need: 5,
      capMicroCents: 1_000_000_000,
      timeBudgetMs: 1,
      overTime: async () => {
        asks += 1;
        return true;
      },
    });
    const result = await h.run();
    expect(asks).toBe(1);
    expect(result).toMatchObject({ played: 5, reasoned: 5, why: "target" });
  });

  it("times every round it plays", async () => {
    const h = harness([{ reasoned: true }, { reasoned: true }, { reasoned: true }]);
    await h.run();
    expect(h.lines.map((l) => l.seconds)).toEqual([60, 60, 60]);
  });
});
