// What the report counts, and what it says when a store does not carry it.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chipRate, collect, sourcesOf, type Report } from "./collect";
import { writeFixture } from "../../../test/helpers/statsStores";
import { loadStores, type Stores } from "./read";

let dir: string;
let report: Report;

beforeEach(() => {
  dir = writeFixture(mkdtempSync(join(tmpdir(), "servpit-stats-")));
  report = collect(loadStores(dir, "fake"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const stat = (label: string) => {
  for (const group of report.groups) {
    const found = group.stats.find((s) => s.label === label || s.label.startsWith(`${label} (`));
    if (found) return found;
  }
  throw new Error(`no stat labelled ${label}. Labels: ${report.groups.flatMap((g) => g.stats.map((s) => s.label)).join(" | ")}`);
};

describe("the pit", () => {
  it("counts the rounds it has in full and the rounds it can only name", () => {
    expect(stat("rounds on file in full detail").text).toBe("4");
    // Every round id any store still mentions, which reaches past the window.
    expect(stat("rounds the pit has played, at least").text).toBe("5");
    expect(stat("rounds the pit has played, at least").note).toContain("a floor");
    expect(stat("where those round ids came from").text).toContain("first seen in the round store");
  });

  it("says which store each figure came from and what it covers", () => {
    expect(stat("rounds on file in full detail").covers).toContain("the round store, the last 200 rounds");
    expect(stat("rounds that settled on chain").covers).toContain("the ledger");
    expect(stat("agents wrecked").covers).toContain("the wreck store");
    expect(stat("handles claimed").covers).toContain("the append only logs");
    // And the period, so a windowed figure can never read as a lifetime one.
    expect(stat("rounds on file in full detail").covers).toMatch(/2026-09-30 to 2026-09-30/);
  });

  it("counts reconciliation both ways, from the verdict on each round", () => {
    expect(stat("rounds reconciled").text).toBe("2 of 4 on file");
    expect(stat("rounds that failed reconciliation").text).toBe("2 of 4 on file");
  });

  it("says why the failures failed, and how far out the worst one was", () => {
    expect(stat("why they failed").text).toBe("1 wallet delta, 1 from rounds stored before the checks were kept");
    // 10000000000000 against 9993117944488, which is the fee gap that caused
    // every live failure.
    expect(stat("worst disagreement").text).toBe("6,882,055,512 wei");
  });

  it("counts the rounds that reached the chain from the ledger, not the round window", () => {
    // Three rounds have a completed transfer with a hash between them.
    expect(stat("rounds that settled on chain").text).toBe("3");
  });

  it("says eliminations across history are not recorded, and counts the one round that has a log", () => {
    expect(stat("eliminations in total").why).toContain("round on screen only");
    expect(stat("eliminations in the round on screen").text).toBe("2");
    expect(stat("that round lasted").text).toBe("9.0 seconds");
  });

  it("names the largest pot and who won the rounds, in chips at the rate on file", () => {
    expect(stat("largest pot on file").text).toBe("50 chips");
    expect(stat("who won them").text).toBe("2 bot, 1 agent, 1 fighter");
  });

  it("adds up what winners were paid", () => {
    expect(stat("chips paid out to winners").text).toBe("50 chips");
  });
});

describe("reasoning", () => {
  it("counts a reasoned round that has aged out of the round store", () => {
    expect(stat("rounds reasoned").number).toBe(2);
    expect(stat("rounds reasoned").covers).toContain("the quoted plans");
    // And the round the plan is for is in the lifetime count.
    expect(stat("where those round ids came from").text).toContain("first seen in the plan store");
  });

  it("counts calls, and the split between reasoned, learned and instinct", () => {
    expect(stat("SERV calls on file").text).toBe("6");
    // r-1 from the round store, and r-0 from a plan quoted before the window.
    expect(stat("rounds reasoned").text).toBe("2");
    expect(stat("rounds drawn from what it learned").text).toBe("1");
    expect(stat("rounds on instinct").text).toBe("2");
    expect(stat("decisions the learning can draw on").text).toBe("2");
  });

  it("totals only the rounds whose cost is their own, and says how many were left out", () => {
    expect(stat("spend on reasoning").text).toBe("$0.014850 across 1 rounds that record their own cost, with 3 older rounds left out because theirs is a meter total");
    expect(stat("tokens in and out").text).toBe("7,200 in, 900 out");
  });

  it("reads latency from the plans still on file", () => {
    expect(stat("median decision latency").text).toContain("9,000 ms");
  });
});

describe("the money", () => {
  it("counts every kind of transfer and the gas behind them", () => {
    expect(stat("entries").text).toBe("2");
    expect(stat("payouts").text).toBe("1");
    expect(stat("loans").text).toBe("1");
    expect(stat("seizures").text).toBe("1");
    expect(stat("repayments").text).toBe("0");
    expect(stat("transactions on chain").text).toBe("4");
    expect(stat("transfers that did not complete").text).toContain("entry failed");
    expect(stat("gas spent").text).toBe("0.000000 ETH");
  });

  it("answers whether reconciliation has ever failed, and admits it cannot say which check", () => {
    expect(stat("has reconciliation ever failed").text).toContain("yes, on 2 of the 4 rounds");
    expect(stat("has reconciliation ever failed").text).toContain("1 wallet delta");
    expect(stat("has reconciliation ever failed").text).toContain("1 stored before the checks were kept");
  });
});

describe("marrow", () => {
  it("counts the lending that has a hash and leaves the rest not recorded", () => {
    expect(stat("loans approved").text).toBe("1");
    expect(stat("lent in total").text).toBe("30 chips");
    expect(stat("biggest single loan").text).toBe("30 chips");
    expect(stat("written off").text).toBe("63 chips");
    expect(stat("seized").text).toBe("4 chips");
    expect(stat("highest rate on the book now").text).toBe("5.00 percent a round");
    expect(stat("loans refused")).toMatchObject({ text: null });
    expect(stat("interest earned")).toMatchObject({ text: null });
    expect(stat("highest rate ever charged")).toMatchObject({ text: null });
  });
});

describe("the dead", () => {
  it("counts the wrecks and reads the careers off them", () => {
    expect(stat("agents wrecked").text).toBe("2");
    expect(stat("what finished them").text).toContain("1 broke and denied credit");
    expect(stat("longest career").text).toBe("27 rounds, Blaze");
    expect(stat("shortest career").text).toBe("3 rounds, Comet");
    expect(stat("biggest peak balance").text).toBe("99 chips");
    expect(stat("largest debt at death").text).toBe("42 chips");
    expect(stat("wrecks that had ever won a round").text).toBe("1");
  });
});

describe("the roster", () => {
  it("says the roster stats are not recorded, because no round keeps its draw", () => {
    for (const label of ["most and least successful character", "rarest draw seen", "three of a kind drawn"]) {
      expect(stat(label), label).toMatchObject({ text: null });
      expect(stat(label).why).toContain("not the characters the reels drew");
    }
    expect(stat("in the round on screen").text).toBe("2 draws, 1 three of a kind, 0 pairs");
  });
});

describe("the players", () => {
  it("counts handles across every log that can hold a claim", () => {
    // ash from the pick log, bowen from the pull log, cass from the fighters.
    expect(stat("handles claimed").text).toBe("3");
  });

  it("counts picks, calls and the boards", () => {
    expect(stat("picks made").text).toBe("2");
    expect(stat("correct picks").text).toBe("1");
    expect(stat("points scored").text).toBe("200");
    expect(stat("best streak").text).toBe("2 in a row, ash");
    expect(stat("rounds called in full").text).toBe("3");
    expect(stat("full calls that were right").text).toBe("2");
  });

  it("reads the fighters and their careers", () => {
    expect(stat("fighters claimed").text).toBe("2 ever, 1 held now");
    expect(stat("best fighter career").text).toBe("Cinder, 3 wins in 40 rounds, 31 kills, longest run of 5");
    expect(stat("kills recorded for claimed fighters").text).toBe("31");
    expect(stat("rounds a claimed fighter has been in").text).toBe("40");
  });
});

describe("with nothing on file", () => {
  it("prints not recorded everywhere rather than a column of zeros", () => {
    const empty: Stores = {
      network: "fake",
      dataDir: "/nowhere",
      rounds: null,
      transfers: null,
      wrecks: null,
      debts: null,
      rollover: null,
      arena: null,
      plans: null,
      picks: null,
      pulls: null,
      fighters: null,
      careers: null,
      leaderboard: null,
  summaries: null,
    };
    const bare = collect(empty);
    const numbers = bare.groups.flatMap((g) => g.stats).filter((s) => s.text !== null && /^[0-9]/.test(s.text));
    // The only counted line with nothing on file is the count of handles,
    // which is genuinely zero across three logs that are not there. Every
    // round figure reads as not recorded, including the lifetime ones.
    expect(numbers.map((s) => s.label)).toEqual(["handles claimed"]);
    expect(bare.groups.flatMap((g) => g.stats).filter((s) => s.text === null).length).toBeGreaterThan(10);
  });

  it("falls back to wei when no store says what a chip is worth", () => {
    expect(chipRate({ arena: null } as Stores)).toBeNull();
  });
});

describe("counting the sources", () => {
  it("counts a round by the best answer any agent in it got", () => {
    expect(
      sourcesOf([
        { roundId: "a", agents: [{ source: "serv", situation: {} }, { source: "heuristic" }] },
        { roundId: "b", agents: [{ source: "learned" }, { source: "heuristic" }] },
        { roundId: "c", agents: [{ source: "heuristic" }] },
        { roundId: "d", agents: [] },
      ]),
    ).toEqual({ reasoned: 1, learned: 1, instinct: 2, learnable: 1 });
  });

  it("only counts a reasoned decision as learnable when it carries its situation", () => {
    expect(sourcesOf([{ roundId: "a", agents: [{ source: "serv" }, { source: "serv", situation: {} }] }]).learnable).toBe(1);
  });
});

describe("where the figures come from", () => {
  it("says the console is the authority on calls and spend, and this is not it", () => {
    const notes = report.notes.join(" ");
    expect(notes).toContain("SERV console is the authority");
    expect(notes).toContain("Nothing in this report can see it");
    expect(notes).toContain("game's own books");
  });

  it("gives the game's own call counts beside it", () => {
    // Six calls in the fixture's window, and no permanent summaries in it.
    expect(report.notes.join(" ")).toContain("6 calls in the round store's window of 4 rounds");
  });

  it("says the lifetime round count is a floor", () => {
    expect(report.notes.join(" ")).toContain("which is a floor");
  });
});
