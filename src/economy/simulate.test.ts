import { describe, expect, it } from "vitest";
import { NAMED_AGENTS } from "@/config/agents";
import { economyConfig } from "@/config/economy";
import { simulate, type SimConfig } from "./simulate";

const config = (overrides: Partial<SimConfig> = {}, terms: Parameters<typeof economyConfig>[1] = {}): SimConfig => ({
  rounds: 200,
  entrants: 24,
  seed: "test",
  bankShare: 0,
  startingBalance: 100n,
  treasury: 500n,
  borrowToStakes: 3n,
  maxStakeMultiple: 3,
  economy: economyConfig(10n, terms),
  ...overrides,
});

describe("simulate", () => {
  it("gives the same answer twice, so a reported number can be reproduced", () => {
    expect(simulate(config())).toEqual(simulate(config()));
  });

  it("keeps every chip accounted for, every round", () => {
    // The invariant is asserted inside the loop, so a run that finishes has
    // held it two hundred times. This states the identity it holds to.
    const r = simulate(config());
    const opening = r.config.treasury + r.config.startingBalance * BigInt(NAMED_AGENTS.length);
    expect(r.agentBalances + r.treasuryEnd + r.rolloverEnd + r.rake + r.retired).toBe(opening + r.operatorInjected);
    // A write off is unpaid debt, not money, so it never appears above.
    expect(r.agentNet).toBe(r.agentBalances + r.retired - r.outstandingDebt - opening + r.treasuryStart - r.operatorInjected);
  });

  it("gives the bank nothing at a share of 0 and everything unclaimed at a share of 1", () => {
    const none = simulate(config({ bankShare: 0, rounds: 60 }));
    const all = simulate(config({ bankShare: 1, rounds: 60 }));
    // At 0 the bank's only income is repayment, so it cannot grow on house
    // wins alone. At 1 every unclaimed prize lands in it.
    expect(all.treasuryEnd).toBeGreaterThan(none.treasuryEnd);
    expect(all.rolloverEnd).toBe(0n);
  });

  it("flags a set of rules that never bites", () => {
    // No interest, no ceiling worth the name, a bank that never refuses, and
    // bankrolls deep enough that nobody runs out. Atlas never borrows at all,
    // so a config where anyone can go broke wrecks it eventually whatever the
    // credit rules say.
    const r = simulate(
      config(
        { rounds: 100, bankPolicy: () => true, treasury: 10_000_000n, startingBalance: 1_000_000n },
        { interestBps: 0, debtCeilingWei: 1_000_000n, maxPrincipalWei: 1_000_000n, maxLoanWei: 1_000_000n },
      ),
    );
    expect(r.wrecks).toBe(0);
    expect(r.flags.join(" ")).toMatch(/never bite/);
  });

  it("flags a set of rules that wrecks everyone at once", () => {
    // Born owing more than the ceiling allows, which is a setting worth
    // seeing rather than a rule worth having.
    const r = simulate(config({ rounds: 100, startingBalance: 5n }, { debtCeilingWei: 1n, replacementDebtWei: 100n }));
    expect(r.allWreckedByRound).not.toBeNull();
    expect(r.flags.join(" ")).toMatch(/every agent wrecked/);
  });

  it("flags a bank that ends unable to write a loan", () => {
    const r = simulate(config({ rounds: 100, treasury: 0n }));
    expect(r.flags.join(" ")).toMatch(/bank insolvent/);
  });

  it("flags a bank holding money it cannot lend under its own share cap", () => {
    // A quarter of 30 is under the 10 chip minimum, so every request is
    // refused while the treasury sits there looking healthy.
    const r = simulate(config({ rounds: 400, treasury: 30n }));
    expect(r.loans).toBe(0);
    expect(r.dryRounds).toBeGreaterThan(0);
    expect(r.flags.join(" ")).toMatch(/never wrote a loan/);
  });

  it("only wrecks on the debt ceiling when there is a bank to owe", () => {
    // An agent that over-reaches usually loses its balance before its debt
    // compounds past the ceiling, so most wrecks are recorded as broke and
    // denied whatever set them off. The ceiling still needs a lender to be
    // reachable at all, which is what this holds.
    const funded = simulate(config({ rounds: 2_000, treasury: 5_000n }));
    const dry = simulate(config({ rounds: 2_000, treasury: 0n }));
    expect(funded.wrecksByReason["debt above the ceiling"]).toBeGreaterThan(0);
    expect(funded.loans).toBeGreaterThan(0);
    // A dry one has nothing to lend, so nobody can owe past a ceiling.
    expect(dry.wrecksByReason["debt above the ceiling"]).toBe(0);
    expect(dry.wrecksByReason["broke and denied credit"]).toBeGreaterThan(0);
    expect(dry.loans).toBe(0);
  });

  it("lends far more often once a stake can exceed a balance", () => {
    // Credit used to happen only when an agent was already broke, which the
    // 12b sweep measured at well under one loan per 100 rounds.
    const levered = simulate(config({ rounds: 2_000, treasury: 5_000n, maxStakeMultiple: 3 }));
    const fixed = simulate(config({ rounds: 2_000, treasury: 5_000n, maxStakeMultiple: 1 }));
    expect(levered.loansPer100Rounds).toBeGreaterThan(fixed.loansPer100Rounds * 2);
  });

  it("wrecks the agents that reach, not the ones that do not", () => {
    const r = simulate(config({ rounds: 2_000, treasury: 5_000n }));
    // Blaze puts up the ceiling every round and borrows for it. Atlas never
    // borrows at all. If the design works, that shows up here.
    expect(r.wrecksByStrategy["aggressive"] ?? 0).toBeGreaterThan(r.wrecksByStrategy["cautious"] ?? 0);
    expect(r.borrowsByStrategy["cautious"] ?? 0).toBe(0);
    expect(r.borrowsByStrategy["aggressive"] ?? 0).toBeGreaterThan(0);
  });

  it("leaves an agent that never borrows close to flat", () => {
    // Leveraged players must not quietly bleed the careful ones.
    const r = simulate(config({ rounds: 2_000, treasury: 5_000n }));
    expect(Math.abs(r.evByStrategy["cautious"] ?? 1)).toBeLessThan(0.1);
  });

  it("refuses a round count or a field that leaves no room for the agents", () => {
    expect(() => simulate(config({ rounds: 0 }))).toThrow(/positive integer/);
    expect(() => simulate(config({ entrants: 3 }))).toThrow(/room for the named agents/);
  });
});
