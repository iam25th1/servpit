// Whether the pit can pay for a round, before it starts one.
//
// The pit used to check the pot alone. An empty bank refused every short
// agent and an empty operator seated their replacements with nothing, and
// both rounds played, every interval, for six weeks. These are the checks
// that stop that, and the figures the status route reports from them.

import { afterEach, describe, expect, it } from "vitest";
import { seatRefillWei, stakeWeiFrom, toChipsUp } from "@/config/stake";
import { bankNeedsWei, fundingCheck, operatorNeedsWei, potNeedsWei, type FundingContext } from "./funding";

afterEach(() => {
  delete process.env.SERVPIT_BANK_ENABLED;
  delete process.env.SERVPIT_RETIREMENTS_PER_HOUR;
});

const RESERVE = stakeWeiFrom() * 2n;

/** Only what the check reads. Every wallet funded unless a test says otherwise. */
function context(options: { pot?: bigint; bank?: bigint | null; operator?: bigint | null; retiredLastHour?: number } = {}): FundingContext {
  const balances: Record<string, bigint> = {
    pot: options.pot ?? stakeWeiFrom() * 100n,
    bank: options.bank ?? stakeWeiFrom() * 100n,
    operator: options.operator ?? stakeWeiFrom() * 100n,
  };
  return {
    chain: { gasReserveWei: RESERVE },
    wallets: {
      pot: { id: "pot" },
      bank: options.bank === null ? undefined : { id: "bank" },
      operator: options.operator === null ? undefined : { id: "operator" },
    },
    bankroll: { get: async (wallet: { id: string }) => balances[wallet.id] ?? 0n },
    flow: {
      rollover: { carriedWei: 0n },
      wreckStore: { countSince: () => options.retiredLastHour ?? 0 },
    },
  } as unknown as FundingContext;
}

describe("what each wallet has to hold", () => {
  it("asks the bank for its largest loan and the fee to send it", () => {
    expect(bankNeedsWei(stakeWeiFrom(), RESERVE)).toBe(stakeWeiFrom() * 3n + RESERVE);
  });

  it("asks the operator for one whole refill and the fee to send it", () => {
    expect(operatorNeedsWei(stakeWeiFrom(), RESERVE)).toBe(seatRefillWei(stakeWeiFrom()) + RESERVE);
  });

  it("asks the pot for the prize it carries and the fee for paying it", () => {
    expect(potNeedsWei(500n, 10n)).toBe(510n);
    expect(potNeedsWei(0n, 10n)).toBe(11n);
  });
});

describe("a pit that cannot pay for a round", () => {
  it("holds on an empty bank, and names the bank", async () => {
    const report = await fundingCheck(context({ bank: 0n }));
    expect(report.ok).toBe(false);
    expect(report.holdKind).toBe("funds");
    expect(report.reason).toBe("The pit is paused because the bank is out of funds. It starts again on its own once it is topped up.");
    expect(report.bank).toMatchObject({ ok: false, chips: 0, shortChips: toChipsUp(bankNeedsWei(stakeWeiFrom(), RESERVE)) });
    expect(report.operator?.ok).toBe(true);
  });

  it("holds on an empty operator, and names the operator", async () => {
    const report = await fundingCheck(context({ operator: 0n }));
    expect(report.ok).toBe(false);
    expect(report.holdKind).toBe("funds");
    expect(report.reason).toMatch(/because the operator is out of funds/);
    expect(report.operator).toMatchObject({ ok: false, shortWei: operatorNeedsWei(stakeWeiFrom(), RESERVE).toString() });
  });

  it("holds on an operator that could only send part of a refill", async () => {
    // A part refill is the other half of the loop: a seat at twenty eight
    // chips is short of a thirty chip seat the moment it sits down.
    const report = await fundingCheck(context({ operator: seatRefillWei(stakeWeiFrom()) / 2n }));
    expect(report.ok).toBe(false);
    expect(report.operator?.ok).toBe(false);
  });

  it("names both when both are short, which is what the live pit was", async () => {
    const report = await fundingCheck(context({ bank: stakeWeiFrom() / 10n, operator: 0n }));
    expect(report.reason).toBe("The pit is paused because the bank and the operator are out of funds. It starts again on its own once they are topped up.");
  });

  it("says exactly what to send, and nothing once it is there", async () => {
    const needs = bankNeedsWei(stakeWeiFrom(), RESERVE);
    const short = await fundingCheck(context({ bank: needs - 1n }));
    expect(short.bank?.shortWei).toBe("1");
    const enough = await fundingCheck(context({ bank: needs }));
    expect(enough.ok).toBe(true);
    expect(enough.bank).toMatchObject({ ok: true, shortWei: "0", shortChips: 0 });
    expect(enough.reason).toBeNull();
    expect(enough.holdKind).toBeNull();
  });

  it("asks nothing of a bank or operator a pit that does not lend would never use", async () => {
    process.env.SERVPIT_BANK_ENABLED = "false";
    const report = await fundingCheck(context({ bank: 0n, operator: 0n }));
    expect(report.ok).toBe(true);
    expect(report.bank).toBeNull();
    expect(report.operator).toBeNull();
  });

  it("does not ask an operator wallet that is not there, and leaves the settle to hold its retirements", async () => {
    const report = await fundingCheck(context({ operator: null }));
    expect(report.ok).toBe(true);
    expect(report.operator).toBeNull();
  });
});

describe("a pit retiring agents faster than luck explains", () => {
  it("holds once the hour has retired as many as it may", async () => {
    process.env.SERVPIT_RETIREMENTS_PER_HOUR = "3";
    const under = await fundingCheck(context({ retiredLastHour: 2 }));
    expect(under.ok).toBe(true);
    expect(under.retirements).toEqual({ lastHour: 2, cap: 3 });

    const at = await fundingCheck(context({ retiredLastHour: 3 }));
    expect(at.ok).toBe(false);
    expect(at.holdKind).toBe("retirements");
    expect(at.reason).toMatch(/retired 3 agents in the last hour, and 3 is its limit/);
  });

  it("says money first when it is both broke and at the limit, because money is what somebody can fix", async () => {
    process.env.SERVPIT_RETIREMENTS_PER_HOUR = "3";
    const report = await fundingCheck(context({ bank: 0n, retiredLastHour: 9 }));
    expect(report.holdKind).toBe("funds");
  });
});
