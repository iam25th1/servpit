import { describe, expect, it } from "vitest";
import { DEFAULT_ROUND } from "../../src/config/round";
import { resolveRound } from "../../src/engine/resolveRound";
import { aggregate } from "./sim-stats";

const entrants = Array.from({ length: 16 }, (_, i) => ({ id: `p${i}` }));
const rounds = [0, 1, 2].map((i) => resolveRound(`stats-${i}`, entrants, DEFAULT_ROUND));

describe("aggregate", () => {
  const s = aggregate(rounds);

  it("counts one win per round and one appearance per entrant per round", () => {
    const wins = Object.values(s.byCharacter).reduce((a, c) => a + c.wins, 0);
    const appearances = Object.values(s.byCharacter).reduce((a, c) => a + c.appearances, 0);
    expect(wins).toBe(3);
    expect(appearances).toBe(48);
  });

  it("splits appearances by tier and by combo", () => {
    expect(s.byTier.common + s.byTier.uncommon + s.byTier.rare).toBe(48);
    expect(s.byCombo.none.appearances + s.byCombo.pair.appearances + s.byCombo.threeOfAKind.appearances).toBe(48);
  });

  it("averages log length and ticks over rounds", () => {
    const events = rounds.reduce((a, r) => a + r.log.length, 0);
    const ticks = rounds.reduce((a, r) => a + r.log[r.log.length - 1].t, 0);
    expect(s.avgEvents).toBe(events / 3);
    expect(s.avgTicks).toBe(ticks / 3);
  });

  it("reports payout conservation and facing validity per round, not just overall", () => {
    expect(s.rounds).toBe(3);
    expect(s.conservationOk).toBe(3);
    expect(s.invalidFacingEvents).toBe(0);
    expect(s.eventsWithoutFacing).toBe(0);
  });

  it("flags a round whose payouts do not match pot minus rake", () => {
    const broken = structuredClone(rounds[0]);
    broken.payouts[0].amount += 1;
    expect(aggregate([broken]).conservationOk).toBe(0);
  });
});
