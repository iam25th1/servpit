import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_STAKE_MULTIPLE, maxStakeMultiple } from "@/config/economy";
import { clampStake, splitCappedPrize } from "./prize";

const env = (vars: Record<string, string> = {}): NodeJS.ProcessEnv => ({ NODE_ENV: "test", ...vars });

describe("clampStake", () => {
  it("holds a stake between the base and the ceiling", () => {
    expect(clampStake(10n, 3, 25n)).toBe(25n);
    expect(clampStake(10n, 3, 10n)).toBe(10n);
    expect(clampStake(10n, 3, 30n)).toBe(30n);
  });

  it("raises anything under the base to the base, because a seat has a price", () => {
    expect(clampStake(10n, 3, 0n)).toBe(10n);
    expect(clampStake(10n, 3, 9n)).toBe(10n);
  });

  it("cuts anything over the ceiling to the ceiling", () => {
    expect(clampStake(10n, 3, 31n)).toBe(30n);
    expect(clampStake(10n, 3, 1_000_000n)).toBe(30n);
  });

  it("collapses to the fixed stake at a multiple of one", () => {
    for (const want of [0n, 10n, 999n]) expect(clampStake(10n, 1, want)).toBe(10n);
  });

  it("refuses a base of nothing, a fractional multiple or a negative want", () => {
    expect(() => clampStake(0n, 3, 10n)).toThrow(/greater than zero/);
    expect(() => clampStake(10n, 0, 10n)).toThrow(/at least 1/);
    expect(() => clampStake(10n, 1.5, 10n)).toThrow(/whole number/);
    expect(() => clampStake(10n, 3, -1n)).toThrow(/non negative/);
  });
});

describe("the ceiling on a stake", () => {
  it("defaults to three stakes and reads the env override", () => {
    expect(DEFAULT_MAX_STAKE_MULTIPLE).toBe(3);
    expect(maxStakeMultiple(env())).toBe(3);
    expect(maxStakeMultiple(env({ SERVPIT_MAX_STAKE_MULTIPLE: "5" }))).toBe(5);
  });

  it("refuses a multiple that is not a whole number of stakes in range", () => {
    for (const bad of ["0", "1.5", "101", "nope", "-2"]) {
      expect(() => maxStakeMultiple(env({ SERVPIT_MAX_STAKE_MULTIPLE: bad })), bad).toThrow(/between 1 and 100/);
    }
  });
});

describe("splitCappedPrize", () => {
  it("pays the whole prize to the biggest staker in the room", () => {
    const s = splitCappedPrize({ poolWei: 1_000n, rakeBps: 0, winnerStakeWei: 30n, highestStakeWei: 30n });
    expect(s.payoutWei).toBe(1_000n);
    expect(s.nextRolloverWei).toBe(0n);
    expect(s.capped).toBe(false);
  });

  it("drains the pot when the field stakes evenly, so nothing is stranded", () => {
    // The property an absolute cap did not have. A field that all stakes the
    // same drains the pot every time an agent wins, however long the rollover
    // has been building.
    const s = splitCappedPrize({ poolWei: 50_000n, rakeBps: 0, winnerStakeWei: 10n, highestStakeWei: 10n });
    expect(s.payoutWei).toBe(50_000n);
    expect(s.nextRolloverWei).toBe(0n);
  });

  it("holds back what the winner did not stake for, and rolls it over", () => {
    // Staked a third of what the room put up, so it takes a third and leaves
    // the rest. This is what stops a minimum stake being the best play.
    const s = splitCappedPrize({ poolWei: 900n, rakeBps: 0, winnerStakeWei: 10n, highestStakeWei: 30n });
    expect(s.capWei).toBe(300n);
    expect(s.payoutWei).toBe(300n);
    expect(s.nextRolloverWei).toBe(600n);
    expect(s.capped).toBe(true);
  });

  it("pays a bigger staker more out of the same pot", () => {
    const small = splitCappedPrize({ poolWei: 900n, rakeBps: 0, winnerStakeWei: 10n, highestStakeWei: 30n });
    const large = splitCappedPrize({ poolWei: 900n, rakeBps: 0, winnerStakeWei: 20n, highestStakeWei: 30n });
    expect(large.payoutWei).toBeGreaterThan(small.payoutWei);
    expect(large.payoutWei).toBe(600n);
  });

  it("rolls the whole prize over when a house bot won", () => {
    const s = splitCappedPrize({ poolWei: 1_000n, rakeBps: 0, winnerStakeWei: null, highestStakeWei: 30n });
    expect(s.payoutWei).toBe(0n);
    expect(s.nextRolloverWei).toBe(1_000n);
  });

  it("takes the rake off the top before the cap is applied", () => {
    const s = splitCappedPrize({ poolWei: 1_000n, rakeBps: 250, winnerStakeWei: 30n, highestStakeWei: 30n });
    expect(s.rakeWei).toBe(25n);
    expect(s.payoutWei).toBe(975n);
    expect(s.nextRolloverWei).toBe(0n);
  });

  it("refuses a field whose biggest stake is below the winner's own", () => {
    expect(() => splitCappedPrize({ poolWei: 100n, rakeBps: 0, winnerStakeWei: 30n, highestStakeWei: 10n })).toThrow(/below the winner/);
  });
});

describe("the 12a invariant, carried forward to variable stakes", () => {
  // Rake plus payout plus rollover equals the pool exactly, and the payout
  // never exceeds the pool. That is the property the fixed stake prize was
  // held to, and a cap must not be a way to lose money out of the middle.
  const POOLS = [0n, 1n, 7n, 240n, 1_000n, 123_456_789n, 10n ** 18n];
  const STAKES = [null, 1n, 10n, 30n, 1_000n, 10n ** 18n];
  const RAKES = [0, 1, 250, 9_999, 10_000];

  it("accounts for every wei, at every stake, cap and rake", () => {
    for (const poolWei of POOLS) {
      for (const winnerStakeWei of STAKES) {
        for (const rakeBps of RAKES) {
          for (const highestStakeWei of [10n ** 18n, winnerStakeWei ?? 1n]) {
            const s = splitCappedPrize({ poolWei, rakeBps, winnerStakeWei, highestStakeWei });
            const label = `pool ${poolWei} stake ${winnerStakeWei} rake ${rakeBps} highest ${highestStakeWei}`;
            expect(s.rakeWei + s.payoutWei + s.nextRolloverWei, label).toBe(poolWei);
            expect(s.payoutWei, label).toBeLessThanOrEqual(poolWei);
            expect(s.payoutWei >= 0n && s.nextRolloverWei >= 0n && s.rakeWei >= 0n, label).toBe(true);
          }
        }
      }
    }
  });

  it("never pays a winner more than its share of the biggest stake", () => {
    for (const poolWei of POOLS) {
      for (const winnerStakeWei of [1n, 10n, 30n]) {
        for (const highestStakeWei of [30n, 100n, 10n ** 18n]) {
          const s = splitCappedPrize({ poolWei, rakeBps: 0, winnerStakeWei, highestStakeWei });
          expect(s.payoutWei).toBeLessThanOrEqual((poolWei * winnerStakeWei) / highestStakeWei);
        }
      }
    }
  });

  it("refuses inputs that are not amounts", () => {
    expect(() => splitCappedPrize({ poolWei: -1n, rakeBps: 0, winnerStakeWei: 1n, highestStakeWei: 1n })).toThrow(/non negative/);
    expect(() => splitCappedPrize({ poolWei: 1n, rakeBps: 10_001, winnerStakeWei: 1n, highestStakeWei: 1n })).toThrow(/between 0 and 10000/);
    expect(() => splitCappedPrize({ poolWei: 1n, rakeBps: 0, winnerStakeWei: -1n, highestStakeWei: 1n })).toThrow(/non negative/);
    expect(() => splitCappedPrize({ poolWei: 1n, rakeBps: 0, winnerStakeWei: 1n, highestStakeWei: -1n })).toThrow(/non negative/);
  });
});
