import { describe, expect, it } from "vitest";
import { splitPrize } from "./prize";

const env = (v: Record<string, string> = {}): NodeJS.ProcessEnv => v as NodeJS.ProcessEnv;
const CHIP = 1_000_000_000_000n;

describe("splitPrize", () => {
  it("pays an agent exactly what came in, plus what rolled over", () => {
    // The old model promised 24 seats and collected from 5. This promises
    // only what it is holding.
    const s = splitPrize({ entriesWei: 50n * CHIP, rolloverWei: 30n * CHIP, rakeBps: 0, agentWon: true }, env());
    expect(s.payoutWei).toBe(80n * CHIP);
    expect(s.nextRolloverWei).toBe(0n);
    expect(s.toBankWei).toBe(0n);
  });

  it("splits an unclaimed prize between the bank and the next round", () => {
    const s = splitPrize({ entriesWei: 50n * CHIP, rolloverWei: 0n, rakeBps: 0, agentWon: false, bankShare: 0.5 }, env());
    expect(s.payoutWei).toBe(0n);
    expect(s.toBankWei).toBe(25n * CHIP);
    expect(s.nextRolloverWei).toBe(25n * CHIP);
  });

  it("gives the bank everything at a share of one, and nothing at zero", () => {
    const all = splitPrize({ entriesWei: 50n * CHIP, rolloverWei: 0n, rakeBps: 0, agentWon: false, bankShare: 1 }, env());
    expect(all.toBankWei).toBe(50n * CHIP);
    expect(all.nextRolloverWei).toBe(0n);
    const none = splitPrize({ entriesWei: 50n * CHIP, rolloverWei: 0n, rakeBps: 0, agentWon: false, bankShare: 0 }, env());
    expect(none.toBankWei).toBe(0n);
    expect(none.nextRolloverWei).toBe(50n * CHIP);
  });

  it("accounts for every wei, whatever the share", () => {
    for (const share of [0, 0.1, 0.333, 0.5, 0.75, 1]) {
      for (const entries of [1n, 7n, 50n * CHIP, 123_456_789n]) {
        const s = splitPrize({ entriesWei: entries, rolloverWei: 13n, rakeBps: 250, agentWon: false, bankShare: share }, env());
        expect(s.rakeWei + s.payoutWei + s.toBankWei + s.nextRolloverWei, `share ${share} entries ${entries}`).toBe(s.poolWei);
      }
    }
  });

  it("rolls the remainder of an odd split over rather than losing it", () => {
    const s = splitPrize({ entriesWei: 3n, rolloverWei: 0n, rakeBps: 0, agentWon: false, bankShare: 0.5 }, env());
    expect(s.toBankWei + s.nextRolloverWei).toBe(3n);
    expect(s.toBankWei).toBe(1n);
    expect(s.nextRolloverWei).toBe(2n);
  });

  it("reads the share from the environment when none is given", () => {
    const s = splitPrize({ entriesWei: 100n, rolloverWei: 0n, rakeBps: 0, agentWon: false }, env({ SERVPIT_BANK_SHARE_ON_HOUSE_WIN: "0.25" }));
    expect(s.toBankWei).toBe(25n);
  });

  it("refuses a share or a rake that is not one", () => {
    expect(() => splitPrize({ entriesWei: 1n, rolloverWei: 0n, rakeBps: 0, agentWon: false, bankShare: 1.5 }, env())).toThrow(RangeError);
    expect(() => splitPrize({ entriesWei: 1n, rolloverWei: 0n, rakeBps: -1, agentWon: true }, env())).toThrow(RangeError);
    expect(() => splitPrize({ entriesWei: -1n, rolloverWei: 0n, rakeBps: 0, agentWon: true }, env())).toThrow(RangeError);
  });
});

describe("the invariant: a prize never exceeds what the pot holds", () => {
  /**
   * The fault this replaces, simulated. The old model paid stake times every
   * seat, so a 24 seat round promised 240 chips while 5 agents paid 50.
   */
  it("held for no sequence under the old model, and holds for every sequence under this one", () => {
    const OLD_PRIZE = 240n * CHIP;
    let oldPot = 249n * CHIP;
    let oldBroke = false;
    let pot = 249n * CHIP;
    let rollover = 0n;
    let minHeadroom = pot;

    // A long run with agent wins a quarter of the time, which is roughly
    // six agents in a field of twenty four.
    for (let round = 0; round < 500; round++) {
      const entries = 50n * CHIP;
      const agentWon = round % 4 === 0;

      oldPot += entries;
      if (agentWon) {
        if (oldPot < OLD_PRIZE) oldBroke = true;
        oldPot -= OLD_PRIZE;
        if (oldPot < 0n) oldPot = 0n;
      }

      pot += entries;
      const s = splitPrize({ entriesWei: entries, rolloverWei: rollover, rakeBps: 0, agentWon, bankShare: 0.5 }, env());
      // Everything that leaves the pot this round.
      const out = s.payoutWei + s.toBankWei + s.rakeWei;
      const headroom = pot - out;
      if (headroom < minHeadroom) minHeadroom = headroom;
      expect(out, `round ${round}`).toBeLessThanOrEqual(pot);
      pot -= out;
      rollover = s.nextRolloverWei;
    }

    expect(oldBroke).toBe(true);
    expect(minHeadroom).toBeGreaterThanOrEqual(0n);
    expect(pot).toBeGreaterThanOrEqual(rollover);
  });

  it("never pays more than the pool it was given, for any share and any outcome", () => {
    for (const agentWon of [true, false]) {
      for (const share of [0, 0.5, 1]) {
        for (const rake of [0, 250, 10_000]) {
          const s = splitPrize({ entriesWei: 77n * CHIP, rolloverWei: 41n * CHIP, rakeBps: rake, agentWon, bankShare: share }, env());
          expect(s.payoutWei + s.toBankWei + s.rakeWei).toBeLessThanOrEqual(s.poolWei);
        }
      }
    }
  });
});
