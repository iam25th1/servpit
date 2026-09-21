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
    // No interest, no ceiling worth the name, endless credit.
    const r = simulate(config({ rounds: 100 }, { interestBps: 0, debtCeilingWei: 1_000_000n, maxPrincipalWei: 1_000_000n }));
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

  it("wrecks on the debt ceiling when the bank has money and on being denied when it does not", () => {
    const funded = simulate(config({ rounds: 2_000 }));
    const dry = simulate(config({ rounds: 2_000, treasury: 0n }));
    // A funded bank wrecks agents for owing too much, not for being refused.
    // The occasional denial still happens, at the principal ceiling.
    expect(funded.wrecksByReason["debt above the ceiling"]).toBeGreaterThan(funded.wrecksByReason["broke and denied credit"]);
    // A dry one has nothing to lend, so every wreck is a refusal.
    expect(dry.wrecksByReason["broke and denied credit"]).toBeGreaterThan(0);
    expect(dry.wrecksByReason["debt above the ceiling"]).toBe(0);
  });

  it("refuses a round count or a field that leaves no room for the agents", () => {
    expect(() => simulate(config({ rounds: 0 }))).toThrow(/positive integer/);
    expect(() => simulate(config({ entrants: 3 }))).toThrow(/room for the named agents/);
  });
});
