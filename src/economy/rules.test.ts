import { describe, expect, it } from "vitest";
import {
  accrueInterest,
  applyWinnings,
  NO_DEBT,
  originateLoan,
  repay,
  replacementAgent,
  seize,
  totalDebt,
  wreckReason,
  type Agent,
  type EconomyConfig,
} from "./rules";

/** Round numbers so an edge is visible rather than buried in arithmetic. */
const config = (overrides: Partial<EconomyConfig> = {}): EconomyConfig => ({
  minLoanWei: 10n,
  maxPrincipalWei: 500n,
  maxTreasuryShareBps: 2_500,
  interestBps: 1_000,
  debtCeilingWei: 600n,
  stakeWei: 10n,
  replacementDebtWei: 0n,
  ...overrides,
});

const agent = (overrides: Partial<Agent> = {}): Agent => ({ id: "atlas", balanceWei: 100n, debt: NO_DEBT, ...overrides });

describe("originateLoan", () => {
  it("lends what was asked when every bound has room", () => {
    const r = originateLoan(config(), 1_000n, agent(), 200n);
    expect(r.approved).toBe(true);
    if (!r.approved) return;
    expect(r.amountWei).toBe(200n);
    expect(r.agent.balanceWei).toBe(300n);
    expect(r.agent.debt.principalWei).toBe(200n);
    expect(r.treasuryWei).toBe(800n);
  });

  it("cuts the loan to the share of the treasury a single loan may take", () => {
    // 25 per cent of 1000 is 250, not the 400 asked for.
    const r = originateLoan(config(), 1_000n, agent(), 400n);
    expect(r.approved && r.amountWei).toBe(250n);
  });

  it("cuts the loan to the room left under the principal ceiling", () => {
    const r = originateLoan(config({ maxTreasuryShareBps: 10_000 }), 10_000n, agent({ debt: { principalWei: 450n, interestWei: 0n } }), 400n);
    expect(r.approved && r.amountWei).toBe(50n);
  });

  it("lends exactly the treasury balance and leaves the bank empty", () => {
    // The named edge. A bank that will lend its whole balance must be able to
    // reach zero exactly, never one short and never one over.
    const r = originateLoan(config({ maxTreasuryShareBps: 10_000 }), 200n, agent(), 200n);
    expect(r.approved).toBe(true);
    if (!r.approved) return;
    expect(r.amountWei).toBe(200n);
    expect(r.treasuryWei).toBe(0n);
    expect(r.agent.debt.principalWei).toBe(200n);
  });

  it("never lends more than the treasury holds, whatever the share allows", () => {
    const r = originateLoan(config({ maxTreasuryShareBps: 10_000 }), 50n, agent(), 400n);
    expect(r.approved && r.amountWei).toBe(50n);
  });

  it("denies an agent already at its principal ceiling, and changes nothing", () => {
    const at = agent({ debt: { principalWei: 500n, interestWei: 0n } });
    const r = originateLoan(config(), 1_000n, at, 100n);
    expect(r.approved).toBe(false);
    if (r.approved) return;
    expect(r.reason).toBe("at the principal ceiling");
    expect(r.agent).toBe(at);
    expect(r.treasuryWei).toBe(1_000n);
  });

  it("denies a loan the treasury cannot bring up to the minimum", () => {
    const r = originateLoan(config(), 20n, agent(), 400n);
    expect(r.approved).toBe(false);
    if (r.approved) return;
    // 25 per cent of 20 is 5, under the 10 minimum.
    expect(r.reason).toBe("treasury cannot cover the minimum");
  });

  it("denies an empty treasury and a request that is not positive", () => {
    expect(originateLoan(config(), 0n, agent(), 100n).approved).toBe(false);
    const zero = originateLoan(config(), 1_000n, agent(), 0n);
    expect(zero.approved).toBe(false);
    if (zero.approved) return;
    expect(zero.reason).toBe("request not positive");
  });

  it("refuses a negative treasury or balance rather than lending against it", () => {
    expect(() => originateLoan(config(), -1n, agent(), 100n)).toThrow(/non negative/);
    expect(() => originateLoan(config(), 1_000n, agent({ balanceWei: -1n }), 100n)).toThrow(/non negative/);
  });
});

describe("accrueInterest", () => {
  it("charges a share of outstanding principal, not of the total debt", () => {
    // Simple, not compound: 10 per cent of 200 principal is 20, whatever
    // interest has already piled up.
    const a = agent({ debt: { principalWei: 200n, interestWei: 55n } });
    expect(accrueInterest(config(), a).debt.interestWei).toBe(75n);
    const twice = accrueInterest(config(), accrueInterest(config(), a));
    expect(twice.debt.interestWei).toBe(95n);
    expect(twice.debt.principalWei).toBe(200n);
  });

  it("charges nothing on no principal and nothing at a zero rate", () => {
    expect(accrueInterest(config(), agent()).debt).toBe(NO_DEBT);
    const a = agent({ debt: { principalWei: 200n, interestWei: 0n } });
    expect(accrueInterest(config({ interestBps: 0 }), a)).toBe(a);
  });

  it("floors rather than rounding up, so the agent is never overcharged by a wei", () => {
    const a = agent({ debt: { principalWei: 9n, interestWei: 0n } });
    // 10 per cent of 9 is 0.9, which is 0.
    expect(accrueInterest(config(), a).debt.interestWei).toBe(0n);
  });

  it("refuses a rate outside basis points", () => {
    expect(() => accrueInterest(config({ interestBps: 10_001 }), agent())).toThrow(/between 0 and 10000/);
  });
});

describe("repay and applyWinnings", () => {
  const owing = (): Agent => agent({ balanceWei: 0n, debt: { principalWei: 100n, interestWei: 30n } });

  it("pays interest before principal", () => {
    const r = repay(owing().debt, 50n);
    expect(r.interestPaidWei).toBe(30n);
    expect(r.principalPaidWei).toBe(20n);
    expect(r.debt).toEqual({ principalWei: 80n, interestWei: 0n });
    expect(r.leftoverWei).toBe(0n);
  });

  it("puts a win smaller than the accrued interest entirely into interest", () => {
    // The named edge. Principal must come out untouched, or an agent that
    // cannot keep up looks like it is making progress.
    const r = repay(owing().debt, 12n);
    expect(r.interestPaidWei).toBe(12n);
    expect(r.principalPaidWei).toBe(0n);
    expect(r.debt).toEqual({ principalWei: 100n, interestWei: 18n });
    expect(r.leftoverWei).toBe(0n);
  });

  it("clears a debt exactly and leaves nothing over", () => {
    // The named edge. 130 owed, 130 won.
    const { agent: after, toTreasuryWei, repayment } = applyWinnings(owing(), 130n);
    expect(totalDebt(after.debt)).toBe(0n);
    expect(after.balanceWei).toBe(0n);
    expect(toTreasuryWei).toBe(130n);
    expect(repayment.leftoverWei).toBe(0n);
  });

  it("keeps only what is left after the debt is cleared", () => {
    const { agent: after, toTreasuryWei } = applyWinnings(owing(), 200n);
    expect(after.debt).toEqual({ principalWei: 0n, interestWei: 0n });
    expect(after.balanceWei).toBe(70n);
    expect(toTreasuryWei).toBe(130n);
  });

  it("sends a debt free agent's whole win to its balance", () => {
    const { agent: after, toTreasuryWei } = applyWinnings(agent(), 60n);
    expect(after.balanceWei).toBe(160n);
    expect(toTreasuryWei).toBe(0n);
  });

  it("refuses a negative repayment", () => {
    expect(() => repay(owing().debt, -1n)).toThrow(/non negative/);
  });
});

describe("wreckReason", () => {
  it("wrecks an agent whose debt passed the ceiling, even holding money", () => {
    const rich = agent({ balanceWei: 1_000n, debt: { principalWei: 500n, interestWei: 101n } });
    expect(wreckReason(config(), rich, false)).toBe("debt above the ceiling");
  });

  it("does not wreck an agent sitting exactly on the ceiling", () => {
    const edge = agent({ balanceWei: 1_000n, debt: { principalWei: 500n, interestWei: 100n } });
    expect(wreckReason(config(), edge, false)).toBeNull();
  });

  it("wrecks an agent that cannot afford a seat and was refused credit", () => {
    expect(wreckReason(config(), agent({ balanceWei: 9n }), true)).toBe("broke and denied credit");
  });

  it("spares a broke agent that was still offered credit", () => {
    expect(wreckReason(config(), agent({ balanceWei: 9n }), false)).toBeNull();
  });

  it("spares an agent holding exactly the stake", () => {
    expect(wreckReason(config(), agent({ balanceWei: 10n }), true)).toBeNull();
  });

  it("reports the debt ceiling first when both conditions hold at once", () => {
    const both = agent({ balanceWei: 0n, debt: { principalWei: 500n, interestWei: 200n } });
    expect(wreckReason(config(), both, true)).toBe("debt above the ceiling");
  });
});

describe("seize", () => {
  it("recovers what the balance covers and writes off the rest", () => {
    const s = seize(agent({ balanceWei: 40n, debt: { principalWei: 100n, interestWei: 30n } }));
    expect(s.seizedWei).toBe(40n);
    expect(s.writtenOffWei).toBe(90n);
    expect(s.agent.balanceWei).toBe(0n);
    expect(s.agent.debt).toEqual({ principalWei: 0n, interestWei: 0n });
  });

  it("writes off the whole debt when there is nothing to take", () => {
    const s = seize(agent({ balanceWei: 0n, debt: { principalWei: 100n, interestWei: 30n } }));
    expect(s.seizedWei).toBe(0n);
    expect(s.writtenOffWei).toBe(130n);
  });

  it("takes the debt exactly and writes off nothing when the balance covers it", () => {
    const s = seize(agent({ balanceWei: 130n, debt: { principalWei: 100n, interestWei: 30n } }));
    expect(s.seizedWei).toBe(130n);
    expect(s.writtenOffWei).toBe(0n);
    expect(s.agent.balanceWei).toBe(0n);
  });

  it("never takes more than is owed", () => {
    const s = seize(agent({ balanceWei: 500n, debt: { principalWei: 100n, interestWei: 30n } }));
    expect(s.seizedWei).toBe(130n);
    expect(s.agent.balanceWei).toBe(370n);
    expect(s.writtenOffWei).toBe(0n);
  });

  it("takes nothing from an agent that owes nothing", () => {
    const s = seize(agent({ balanceWei: 500n }));
    expect(s.seizedWei).toBe(0n);
    expect(s.writtenOffWei).toBe(0n);
    expect(s.agent.balanceWei).toBe(500n);
  });
});

describe("replacementAgent", () => {
  it("is born clean when no replacement debt is configured", () => {
    const a = replacementAgent(config(), "nova", 100n);
    expect(a.balanceWei).toBe(100n);
    expect(totalDebt(a.debt)).toBe(0n);
  });

  it("is born owing the configured principal, with no interest yet", () => {
    const a = replacementAgent(config({ replacementDebtWei: 250n }), "nova", 100n);
    expect(a.debt).toEqual({ principalWei: 250n, interestWei: 0n });
    // The first round it plays charges interest on that principal.
    expect(accrueInterest(config({ replacementDebtWei: 250n }), a).debt.interestWei).toBe(25n);
  });

  it("can be born already past the ceiling, which is a setting worth seeing", () => {
    const tight = config({ replacementDebtWei: 700n, debtCeilingWei: 600n });
    expect(wreckReason(tight, replacementAgent(tight, "nova", 100n), false)).toBe("debt above the ceiling");
  });

  it("refuses negative funding or a negative replacement debt", () => {
    expect(() => replacementAgent(config(), "nova", -1n)).toThrow(/non negative/);
    expect(() => replacementAgent(config({ replacementDebtWei: -1n }), "nova", 100n)).toThrow(/non negative/);
  });
});

describe("the module is pure", () => {
  it("never mutates what it was given", () => {
    const before = agent({ balanceWei: 100n, debt: { principalWei: 200n, interestWei: 10n } });
    const snapshot = { ...before, debt: { ...before.debt } };
    originateLoan(config(), 1_000n, before, 100n);
    accrueInterest(config(), before);
    applyWinnings(before, 500n);
    seize(before);
    expect(before).toEqual(snapshot);
  });
});
