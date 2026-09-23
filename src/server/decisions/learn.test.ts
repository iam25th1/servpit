import { describe, expect, it } from "vitest";
import type { StoredRound } from "../round/store";
import { MIN_MATCHES, learnedDecision } from "./learn";
import { bandOf, situationOf, type Situation } from "./situation";
import type { AgentSnapshot, RoundContext } from "./types";

const STAKE_CHIPS = 10;

const situation = (over: Partial<Situation> = {}): Situation => ({
  balanceChips: 100,
  debtChips: 0,
  potChips: 240,
  field: 24,
  recentEntered: 2,
  recentAhead: 1,
  ...over,
});

/** A stored round holding one decision by one agent in a given spot. */
const round = (over: { source?: "serv" | "learned" | "heuristic"; entered?: boolean; stake?: number; situation?: Situation | undefined; agentId?: string } = {}): StoredRound =>
  ({
    roundId: `r-${Math.random().toString(36).slice(2)}`,
    seed: "seed",
    createdAt: "2026-09-22T00:00:00.000Z",
    network: "fake",
    entrants: 24,
    winner: "bot-01",
    potWei: "0",
    rakeWei: "0",
    reconciled: true,
    servCalls: 6,
    servMicroCents: 1_000,
    agents: [
      {
        agentId: over.agentId ?? "atlas",
        name: "Atlas",
        strategy: "cautious",
        address: "0x" + "1".repeat(40),
        entered: over.entered ?? true,
        stake: over.stake ?? STAKE_CHIPS,
        reason: "because",
        source: over.source ?? "serv",
        ...(over.situation === undefined ? {} : { situation: over.situation }),
        balanceBeforeWei: "0",
        balanceAfterWei: "0",
      },
    ],
  }) as StoredRound;

const many = (count: number, over: Parameters<typeof round>[0] = {}): StoredRound[] => Array.from({ length: count }, () => round(over));

describe("drawing a decision from the record", () => {
  it("says nothing at all below the minimum, so the fixed rule answers", () => {
    const rounds = many(MIN_MATCHES - 1, { situation: situation() });
    expect(learnedDecision("atlas", situation(), STAKE_CHIPS, rounds)).toBeNull();
  });

  it("speaks once it has seen enough of the same kind of spot", () => {
    const rounds = many(MIN_MATCHES, { situation: situation() });
    const learned = learnedDecision("atlas", situation(), STAKE_CHIPS, rounds);
    expect(learned).not.toBeNull();
    expect(learned!.decision.enter).toBe(true);
    expect(learned!.evidence.matches).toBe(MIN_MATCHES);
    expect(learned!.evidence.entered).toBe(MIN_MATCHES);
  });

  it("takes what serv decided, and never what happened next", () => {
    // Every one of these rounds was won by a house bot and every agent lost
    // its entry. The record still says serv entered, so the pit enters: one
    // fight in twenty four is variance, and learning from results at this
    // sample size is learning from noise.
    const rounds = many(6, { situation: situation(), entered: true });
    const learned = learnedDecision("atlas", situation(), STAKE_CHIPS, rounds);
    expect(learned!.decision.enter).toBe(true);
  });

  it("holds when the reasoned rounds mostly held, and on a tie", () => {
    const held = [...many(4, { situation: situation(), entered: false, stake: 0 }), ...many(2, { situation: situation(), entered: true })];
    expect(learnedDecision("atlas", situation(), STAKE_CHIPS, held)!.decision.enter).toBe(false);

    const tied = [...many(3, { situation: situation(), entered: false, stake: 0 }), ...many(3, { situation: situation(), entered: true })];
    // A tie holds: entering spends a seat and can wreck an agent, holding
    // spends nothing.
    expect(learnedDecision("atlas", situation(), STAKE_CHIPS, tied)!.decision.enter).toBe(false);
  });

  it("puts up what it usually put up, rather than an average nobody chose", () => {
    const rounds = [
      ...many(3, { situation: situation(), stake: 10 }),
      ...many(2, { situation: situation(), stake: 30 }),
    ];
    const learned = learnedDecision("atlas", situation(), STAKE_CHIPS, rounds);
    expect(learned!.evidence.typicalStake).toBe(10);
    expect(learned!.decision.stake).toBe(10);
  });

  it("never goes below this round's seat price", () => {
    const rounds = many(5, { situation: situation(), stake: 1 });
    expect(learnedDecision("atlas", situation(), STAKE_CHIPS, rounds)!.decision.stake).toBe(STAKE_CHIPS);
  });

  it("reads only this agent's own rounds", () => {
    const others = many(9, { situation: situation(), agentId: "blaze" });
    expect(learnedDecision("atlas", situation(), STAKE_CHIPS, others)).toBeNull();
  });

  it("reads only reasoned rounds, so it never learns from its own echo", () => {
    const echo = many(9, { situation: situation(), source: "learned" });
    expect(learnedDecision("atlas", situation(), STAKE_CHIPS, echo)).toBeNull();
    const fixed = many(9, { situation: situation(), source: "heuristic" });
    expect(learnedDecision("atlas", situation(), STAKE_CHIPS, fixed)).toBeNull();
  });

  it("skips rounds stored before the pit recorded the spot", () => {
    const old = many(9, { situation: undefined });
    expect(learnedDecision("atlas", situation(), STAKE_CHIPS, old)).toBeNull();
  });

  it("only matches rounds in the same band", () => {
    // Deep pockets and no debt is not the same spot as one seat left.
    const rich = many(9, { situation: situation({ balanceChips: 1_000 }) });
    expect(learnedDecision("atlas", situation({ balanceChips: 15 }), STAKE_CHIPS, rich)).toBeNull();
  });

  it("gives the same answer twice for the same spot and the same record", () => {
    const rounds = [...many(4, { situation: situation() }), ...many(2, { situation: situation(), entered: false, stake: 0 })];
    const first = learnedDecision("atlas", situation(), STAKE_CHIPS, rounds);
    const second = learnedDecision("atlas", situation(), STAKE_CHIPS, rounds);
    expect(first).toEqual(second);
    // And the same answer whatever order the record is read in.
    expect(learnedDecision("atlas", situation(), STAKE_CHIPS, [...rounds].reverse())).toEqual(first);
  });

  it("names what it was drawn from, so the screen can show it", () => {
    const rounds = [...many(6, { situation: situation() }), ...many(1, { situation: situation(), entered: false, stake: 0 })];
    const learned = learnedDecision("atlas", situation(), STAKE_CHIPS, rounds)!;
    expect(learned.evidence).toMatchObject({ matches: 7, entered: 6 });
    expect(learned.decision.reason).toMatch(/learned: in 7 reasoned rounds/);
    expect(learned.evidence.band).toBe(bandOf(situation(), STAKE_CHIPS));
  });
});

describe("the spot an agent was in", () => {
  const snapshot = (over: Partial<AgentSnapshot> = {}): AgentSnapshot =>
    ({
      profile: { id: "atlas", name: "Atlas", strategy: "cautious", minBankrollMultiple: 3, baseEnterChance: 50, afterWinShift: 5, afterLossShift: -5 },
      address: "0x" + "1".repeat(40),
      balanceWei: 100_000_000_000_000n,
      stakeWei: 10_000_000_000_000n,
      recentOutcomes: [],
      ...over,
    }) as AgentSnapshot;

  const context: RoundContext = { roundId: "r-1", participants: 24, poolWei: 240_000_000_000_000n, stakeWei: 10_000_000_000_000n };

  it("records what the answer actually turns on", () => {
    const spot = situationOf(
      snapshot({
        debtWei: 20_000_000_000_000n,
        recentOutcomes: [
          { roundId: "r-a", entered: true, netWei: 5n },
          { roundId: "r-b", entered: true, netWei: -5n },
          { roundId: "r-c", entered: false, netWei: 0n },
        ],
      }),
      context,
    );
    expect(spot).toEqual({ balanceChips: 100, debtChips: 20, potChips: 240, field: 24, recentEntered: 2, recentAhead: 1 });
  });

  it("puts the same kind of spot in the same band, and a different one apart", () => {
    expect(bandOf(situation({ balanceChips: 91 }), STAKE_CHIPS)).toBe(bandOf(situation({ balanceChips: 94 }), STAKE_CHIPS));
    expect(bandOf(situation({ balanceChips: 5 }), STAKE_CHIPS)).not.toBe(bandOf(situation({ balanceChips: 400 }), STAKE_CHIPS));
    expect(bandOf(situation({ debtChips: 0 }), STAKE_CHIPS)).not.toBe(bandOf(situation({ debtChips: 80 }), STAKE_CHIPS));
    expect(bandOf(situation({ field: 8 }), STAKE_CHIPS)).not.toBe(bandOf(situation({ field: 24 }), STAKE_CHIPS));
  });
});
