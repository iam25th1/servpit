import { describe, expect, it } from "vitest";
import { bankApproves, stakeIntentFor, type StakeContext } from "./personalities";

const ctx = (over: Partial<StakeContext> = {}): StakeContext => ({
  baseStakeWei: 10n,
  maxMultiple: 3,
  balanceWei: 100n,
  rolloverWei: 0n,
  entrants: 24,
  recent: [],
  fieldAverageWei: 10n,
  ...over,
});

const won = { entered: true, netWei: 50n };
const lost = { entered: true, netWei: -10n };
const satOut = { entered: false, netWei: 0n };

describe("what each agent puts up", () => {
  it("Atlas stakes the floor and will not borrow, ever", () => {
    const i = stakeIntentFor("cautious", ctx({ rolloverWei: 100_000n, recent: [won, won, won] }));
    expect(i.stakeWei).toBe(10n);
    expect(i.borrow).toBe(false);
  });

  it("Ember stays at the floor but will borrow to keep its seat", () => {
    const i = stakeIntentFor("steady", ctx({ recent: [won, won] }));
    expect(i.stakeWei).toBe(10n);
    expect(i.borrow).toBe(true);
  });

  it("Blaze puts up the ceiling and does not mind owing for it", () => {
    const i = stakeIntentFor("aggressive", ctx({ balanceWei: 0n }));
    expect(i.stakeWei).toBe(30n);
    expect(i.borrow).toBe(true);
  });

  it("Comet adds a stake for every win behind it, and stops at the ceiling", () => {
    expect(stakeIntentFor("streak-chaser", ctx({ recent: [] })).stakeWei).toBe(10n);
    expect(stakeIntentFor("streak-chaser", ctx({ recent: [won] })).stakeWei).toBe(20n);
    expect(stakeIntentFor("streak-chaser", ctx({ recent: [won, won] })).stakeWei).toBe(30n);
    expect(stakeIntentFor("streak-chaser", ctx({ recent: [won, won, won, won] })).stakeWei).toBe(30n);
  });

  it("Comet's streak ends at the first round that was not a win", () => {
    expect(stakeIntentFor("streak-chaser", ctx({ recent: [won, won, lost] })).stakeWei).toBe(10n);
    expect(stakeIntentFor("streak-chaser", ctx({ recent: [won, won, satOut] })).stakeWei).toBe(10n);
    expect(stakeIntentFor("streak-chaser", ctx({ recent: [lost, won] })).stakeWei).toBe(20n);
    expect(stakeIntentFor("streak-chaser", ctx({ recent: [lost] })).borrow).toBe(false);
  });

  it("Delta steps up when the room is timid and sits at the floor when it is not", () => {
    const timid = stakeIntentFor("contrarian", ctx({ fieldAverageWei: 10n }));
    expect(timid.stakeWei).toBe(30n);
    expect(timid.borrow).toBe(true);
    const bold = stakeIntentFor("contrarian", ctx({ fieldAverageWei: 25n }));
    expect(bold.stakeWei).toBe(10n);
    expect(bold.borrow).toBe(false);
  });

  it("Flint raises only for a pot worth raising for", () => {
    // A rollover worth a full field at the base stake, and not a chip less.
    const small = stakeIntentFor("opportunist", ctx({ rolloverWei: 239n }));
    expect(small.stakeWei).toBe(10n);
    expect(small.borrow).toBe(false);
    const big = stakeIntentFor("opportunist", ctx({ rolloverWei: 240n }));
    expect(big.stakeWei).toBe(30n);
    expect(big.borrow).toBe(true);
  });

  it("keeps every personality inside the bounds, whatever it asks for", () => {
    for (const strategy of ["cautious", "aggressive", "streak-chaser", "contrarian", "steady", "opportunist"] as const) {
      for (const recent of [[], [won, won, won, won, won], [lost, lost]]) {
        for (const rolloverWei of [0n, 10n ** 9n]) {
          const i = stakeIntentFor(strategy, ctx({ recent, rolloverWei }));
          expect(i.stakeWei, strategy).toBeGreaterThanOrEqual(10n);
          expect(i.stakeWei, strategy).toBeLessThanOrEqual(30n);
        }
      }
    }
  });

  it("collapses every personality to the fixed stake at a multiple of one", () => {
    for (const strategy of ["cautious", "aggressive", "streak-chaser", "contrarian", "steady", "opportunist"] as const) {
      expect(stakeIntentFor(strategy, ctx({ maxMultiple: 1, recent: [won, won], rolloverWei: 10n ** 9n })).stakeWei, strategy).toBe(10n);
    }
  });
});

describe("whether the bank will lend to this borrower", () => {
  const record = (over: Partial<Parameters<typeof bankApproves>[0]> = {}) => ({ owedWei: 0n, wrecks: 0, recent: [], baseStakeWei: 10n, ...over });

  it("lends to someone with no history against them", () => {
    expect(bankApproves(record())).toBe(true);
    expect(bankApproves(record({ owedWei: 25n, recent: [lost, won, lost] }))).toBe(true);
  });

  it("refuses to fund the same mistake a third time", () => {
    expect(bankApproves(record({ wrecks: 2, owedWei: 5n }))).toBe(false);
    // Wrecked twice but owing nothing is a fresh start, not a pattern.
    expect(bankApproves(record({ wrecks: 2, owedWei: 0n }))).toBe(true);
    expect(bankApproves(record({ wrecks: 1, owedWei: 100n }))).toBe(true);
  });

  it("refuses a losing streak that is already carrying more than a seat", () => {
    expect(bankApproves(record({ owedWei: 11n, recent: [lost, lost, lost] }))).toBe(false);
    // The same streak while owing a seat or less is a bad run, not a pattern.
    expect(bankApproves(record({ owedWei: 10n, recent: [lost, lost, lost] }))).toBe(true);
    // Rounds it sat out do not count against it.
    expect(bankApproves(record({ owedWei: 50n, recent: [lost, satOut, lost, satOut, lost] }))).toBe(false);
    expect(bankApproves(record({ owedWei: 50n, recent: [lost, lost, won] }))).toBe(true);
  });

  it("needs three entered rounds before it calls anything a streak", () => {
    expect(bankApproves(record({ owedWei: 100n, recent: [lost, lost] }))).toBe(true);
  });
});
