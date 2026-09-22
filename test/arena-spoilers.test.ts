// Nothing that decides the fight may be readable before the fight is shown.
//
// The resolver is deterministic, so a seed and an entrant list are a winner.
// A viewer with a terminal must not be able to know the result while the
// agents are still deciding, and anything built on watching the round happen
// depends on that being true of every response, not just the ones that
// obviously carry it.
//
// This drives the real projection with a round that carries the outcome in
// every phase, including the phases where the worker would never have written
// it, and fails if any of it survives into a response.

import { describe, expect, it } from "vitest";
import { arenaView, phaseEvent, roundView } from "@/server/arena/view";
import type { ArenaPhase, ArenaRound, ArenaState } from "@/server/arena/state";

const SEED = "arena-spoilerseed";
const WINNER = "agent-flint";
const LOG_MARKER = "spoiler-event";
const PLACEMENT = "agent-blaze";

/** Everything the resolver needs, or produces, which is the same thing. */
const outcome = {
  seed: SEED,
  durationMs: 12_000,
  characters: [{ entrantId: WINNER, tier: "rare" }],
  log: [{ t: 1, type: LOG_MARKER, id: WINNER }],
  placements: [WINNER, PLACEMENT],
  names: { [WINNER]: "Flint" },
};

const round = (phase: ArenaPhase): ArenaRound => ({
  roundId: "r-spoiler",
  startedAt: "2026-09-21T00:00:00.000Z",
  phase,
  phases: [{ phase, at: "2026-09-21T00:00:00.000Z", ...(phase === "fight" ? { durationMs: 12_000 } : {}) }],
  network: "fake",
  backend: "fake",
  entrants: 24,
  bots: 20,
  stakeChips: 10,
  weiPerChip: "1000000000000",
  decisions: [{ agentId: "flint", name: "Flint", face: null, enter: true, stake: 10, reason: "I am in.", source: "serv", balance: 40, debt: 0 }],
  loans: [],
  refusals: [],
  bank: { treasury: 900, book: [] },
  entries: [{ agentId: "flint", amountWei: "10000000000000", txHash: null, link: null }],
  // A draw for somebody who is neither the winner nor in the placements, so
  // the check below still catches a winner that escapes into the payload. In
  // a real round every entrant has a draw, including whoever wins, and that
  // is not a leak: one of twenty four ids, indistinguishable from the rest.
  reels: [{ entrantId: "agent-comet", symbols: ["a", "b", "c"], characterId: "Knight", tier: "rare", combo: "three", bonusPct: 10 }],
  fight: outcome,
  result: {
    winner: WINNER,
    potWei: "40000000000000",
    rakeWei: "0",
    payoutWei: "40000000000000",
    rolloverInWei: "0",
    nextRolloverWei: "0",
    reconciled: true,
    transfers: [],
    repayment: null,
    wrecks: [],
    replacements: [],
    interest: [],
    servCalls: 6,
    costSummary: "6 calls",
    agents: [{ agentId: "flint", name: "Flint", balanceBeforeWei: "1", balanceAfterWei: "2" }],
    checks: [{ name: "conservation", ok: true, expected: "1", actual: "1" }],
    settles: false,
  },
});

const state = (phase: ArenaPhase): ArenaState => ({ round: round(phase), last: null, paused: false, nextRoundAt: null, updatedAt: "2026-09-21T00:00:00.000Z" });

/** Every phase a round passes through before its fight is on screen. */
const BEFORE_THE_FIGHT: ArenaPhase[] = ["planning", "deciding", "banking", "settling", "reels", "resting", "failed"];

const spoilers = (body: string): string[] =>
  [
    [SEED, "the seed"],
    [WINNER, "the winner"],
    [LOG_MARKER, "the event log"],
    [PLACEMENT, "the placements"],
    ["placements", "a placements field"],
    ["\"log\"", "a log field"],
    ["\"seed\"", "a seed field"],
  ]
    .filter(([needle]) => body.includes(needle))
    .map(([, what]) => what);

describe("before the fight", () => {
  it("gives away nothing that decides it, in any phase", () => {
    for (const phase of BEFORE_THE_FIGHT) {
      const body = JSON.stringify(arenaView(state(phase), { network: "fake", kind: "fake" }));
      expect(spoilers(body), `${phase} leaked ${spoilers(body).join(", ")}`).toEqual([]);
    }
  });

  it("gives away nothing in a phase event either", () => {
    for (const phase of BEFORE_THE_FIGHT) {
      const body = JSON.stringify(phaseEvent(arenaView(state(phase), { network: "fake", kind: "fake" })));
      expect(spoilers(body), `${phase} leaked in the stream`).toEqual([]);
    }
  });

  it("still shows the round a viewer is there to watch", () => {
    const view = arenaView(state("deciding"), { network: "fake", kind: "fake" });
    expect(view.round?.decisions[0]?.name).toBe("Flint");
    expect(view.round?.decisions[0]?.source).toBe("serv");
    expect(view.round?.entries).toHaveLength(1);
    expect(view.round?.bank?.treasury).toBe(900);
    expect(view.round?.phases[0]?.at).toBe("2026-09-21T00:00:00.000Z");
  });

  it("never carries a winner or a placements field before the fight, whatever it carries", () => {
    for (const phase of BEFORE_THE_FIGHT) {
      const view = roundView(round(phase))!;
      expect(Object.keys(view)).not.toContain("fight");
      expect(Object.keys(view)).not.toContain("result");
    }
  });

  it("still shows the draw, which does not decide anything", () => {
    // The reels pick a fighter's character and the resolver runs the same way
    // whoever is in it, so the reveal is allowed to happen before the fight.
    const view = roundView(round("reels"))!;
    expect(view.reels).toHaveLength(1);
    expect("fight" in view).toBe(false);
  });

  it("drops the whole fight and the whole result, not some fields of them", () => {
    const view = roundView(round("settling"))!;
    expect("fight" in view).toBe(false);
    expect("result" in view).toBe(false);
  });
});

describe("from the fight onwards", () => {
  it("shows the fight, because that is the moment it is for", () => {
    const view = arenaView(state("fight"), { network: "fake", kind: "fake" });
    expect(view.round?.fight?.seed).toBe(SEED);
    expect(view.round?.fight?.durationMs).toBe(12_000);
    expect(view.round?.fight?.placements).toEqual([WINNER, PLACEMENT]);
  });

  it("shows the result once it is settled", () => {
    const view = arenaView(state("result"), { network: "fake", kind: "fake" });
    expect(view.round?.result?.winner).toBe(WINNER);
    expect(view.round?.result?.reconciled).toBe(true);
  });

  it("keeps the last finished round whole while a new one is still deciding", () => {
    const live = state("deciding");
    const finished = round("result");
    const view = arenaView({ ...live, last: finished }, { network: "fake", kind: "fake" });
    // The live round gives nothing away and the finished one is history.
    expect(JSON.stringify(view.round).includes(SEED)).toBe(false);
    expect(view.last?.result?.winner).toBe(WINNER);
  });
});
