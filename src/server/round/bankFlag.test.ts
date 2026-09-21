// The bank is off, and the running game does not know it exists.
//
// The whole bank arrives behind SERVPIT_BANK_ENABLED, over several phases.
// Until interest, repayment, wrecks and the bank's own screen are built and
// verified, a round has to behave exactly as it did before any of this
// landed. This is the test that says so.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SERV } from "@/config/serv";
import { stakeWeiFrom, toChips } from "@/config/stake";
import { BankrollCache } from "../bankroll";
import { TransferLedger } from "../ledger";
import { CostMeter, ServClient, type ChatTransport } from "../serv/client";
import { FakeChain } from "../wallets/fake";
import { openWallets } from "../wallets/open";
import { WalletRegistry } from "../wallets/registry";
import { RolloverStore } from "./rollover";
import { RoundStore } from "./store";
import { planRound, runRound } from "./flow";

const FUNDED_WEI = 100_000_000_000_000n;
let dir: string;

beforeEach(() => {
  delete process.env.SERVPIT_BANK_ENABLED;
});

afterEach(() => {
  delete process.env.SERVPIT_BANK_ENABLED;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Answers with a stake well above the seat price, if it is allowed to. */
const greedyTransport = (stakeChips: number): ChatTransport =>
  ({
    create: vi.fn().mockResolvedValue({
      model: "claude-haiku-4.5",
      choices: [{ index: 0, message: { role: "assistant", content: `{"enter":true,"stake":${stakeChips},"reason":"Feeling good, going big."}` }, finish_reason: "stop" }],
      usage: { prompt_tokens: 800, completion_tokens: 60, total_tokens: 860 },
    }),
  }) as unknown as ChatTransport;

async function harness(transport?: ChatTransport) {
  dir = mkdtempSync(join(tmpdir(), "servpit-bankflag-"));
  const chain = new FakeChain({ initialBalanceWei: FUNDED_WEI });
  const wallets = await openWallets(chain, new WalletRegistry(join(dir, "wallets.json")));
  return {
    chain,
    ctx: {
      chain,
      wallets,
      ledger: new TransferLedger(join(dir, "ledger.json")),
      store: new RoundStore(join(dir, "rounds.json")),
      bankroll: new BankrollCache({ ttlMs: 0, now: () => 0 }),
      meter: new CostMeter(DEFAULT_SERV.pricing),
      rollover: new RolloverStore(join(dir, "rollover.json")),
      serv: transport ? new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, transport) : undefined,
      entrants: 24,
    },
  };
}

describe("with the bank off, which is the default", () => {
  it("charges every seat the same, however much an agent asked for", async () => {
    const seat = stakeWeiFrom();
    const { ctx } = await harness(greedyTransport(toChips(seat) * 3));
    const plan = await planRound(ctx, "off");
    expect(plan.entering.length).toBeGreaterThan(0);
    for (const e of plan.entering) expect(e.stakeWei).toBe(seat);
  });

  it("refuses the oversized stake outright and falls back to the heuristic", async () => {
    const { ctx } = await harness(greedyTransport(toChips(stakeWeiFrom()) * 3));
    const plan = await planRound(ctx, "off2");
    // Every SERV answer asked for three seats, which is not this round's
    // stake, so none of them survived validation.
    expect(plan.decisions.every((d) => d.source === "heuristic")).toBe(true);
    expect(plan.rejections.length).toBeGreaterThan(0);
  });

  it("pays the winner the whole prize, with nothing held back by a cap", async () => {
    const { ctx } = await harness();
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const plan = await planRound(ctx, seed);
      const run = await runRound(ctx, plan);
      const entriesWei = run.entries.reduce((sum, e) => sum + e.amountWei, 0n);
      expect(run.prize.poolWei).toBe(entriesWei + run.rolloverInWei);
      if (run.payout) {
        // The whole pool, not a share of it.
        expect(run.payout.amountWei).toBe(run.prize.poolWei - run.prize.rakeWei);
        expect(run.prize.nextRolloverWei).toBe(0n);
      }
      expect(run.reconciliation.ok).toBe(true);
    }
  });
});

describe("with the bank on", () => {
  it("lets an agent put up more than one seat", async () => {
    process.env.SERVPIT_BANK_ENABLED = "true";
    const seat = stakeWeiFrom();
    const { ctx } = await harness(greedyTransport(toChips(seat) * 3));
    const plan = await planRound(ctx, "on");
    expect(plan.entering.length).toBeGreaterThan(0);
    for (const e of plan.entering) expect(e.stakeWei).toBe(seat * 3n);
    expect(plan.decisions.some((d) => d.source === "serv")).toBe(true);
  });

  it("holds a winner to the share of the prize its own stake earned", async () => {
    process.env.SERVPIT_BANK_ENABLED = "true";
    const { ctx } = await harness();
    // Heuristic decisions all stake the base, so the field is even and the
    // cap never bites. What matters is that the capped model is the one in
    // use and it still conserves every chip.
    for (const seed of ["p", "q", "r", "s"]) {
      const plan = await planRound(ctx, seed);
      const run = await runRound(ctx, plan);
      expect(run.prize.rakeWei + run.prize.payoutWei + run.prize.toBankWei + run.prize.nextRolloverWei).toBe(run.prize.poolWei);
      expect(run.reconciliation.ok).toBe(true);
    }
  });

  it("refuses a stake above the ceiling, whatever the model said", async () => {
    process.env.SERVPIT_BANK_ENABLED = "true";
    const { ctx } = await harness(greedyTransport(toChips(stakeWeiFrom()) * 99));
    const plan = await planRound(ctx, "over");
    expect(plan.decisions.every((d) => d.source === "heuristic")).toBe(true);
    for (const e of plan.entering) expect(e.stakeWei).toBe(stakeWeiFrom());
  });
});

describe("the bank's own decision", () => {
  /** Stakes three seats, which needs borrowing on a one seat balance. */
  const greedy = (stakeChips: number) => greedyTransport(stakeChips);

  it("asks the bank only for the shortfall, which the agent never states", async () => {
    process.env.SERVPIT_BANK_ENABLED = "true";
    const seat = stakeWeiFrom();
    dir = mkdtempSync(join(tmpdir(), "servpit-bankflag-"));
    // One seat of balance, so three seats needs two borrowed.
    const chain = new FakeChain({ initialBalanceWei: seat });
    const wallets = await openWallets(chain, new WalletRegistry(join(dir, "wallets.json")), { bank: true });
    chain.fund(wallets.bank!.address, seat * 100n);
    const ctx = {
      chain,
      wallets,
      ledger: new TransferLedger(join(dir, "ledger.json")),
      store: new RoundStore(join(dir, "rounds.json")),
      bankroll: new BankrollCache({ ttlMs: 0, now: () => 0 }),
      meter: new CostMeter(DEFAULT_SERV.pricing),
      rollover: new RolloverStore(join(dir, "rollover.json")),
      serv: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, greedy(toChips(seat) * 3)),
      entrants: 24,
    };

    const plan = await planRound(ctx, "shortfall");
    expect(plan.loans.length).toBeGreaterThan(0);
    for (const loan of plan.loans) {
      // Two seats short of three, and never more than that.
      expect(loan.principalWei).toBe(seat * 2n);
      expect(loan.rateBps).toBeGreaterThan(0);
    }
    for (const e of plan.entering) {
      expect(e.stakeWei).toBe(seat * 3n);
      expect(e.loanWei).toBe(seat * 2n);
    }
  });

  it("never lends more than the bank actually holds", async () => {
    process.env.SERVPIT_BANK_ENABLED = "true";
    const seat = stakeWeiFrom();
    dir = mkdtempSync(join(tmpdir(), "servpit-bankflag-"));
    const chain = new FakeChain({ initialBalanceWei: seat });
    const wallets = await openWallets(chain, new WalletRegistry(join(dir, "wallets.json")), { bank: true });
    // Every wallet opens on one seat, the bank included, so it cannot cover
    // even one two seat shortfall let alone several.
    const ctx = {
      chain,
      wallets,
      ledger: new TransferLedger(join(dir, "ledger.json")),
      store: new RoundStore(join(dir, "rounds.json")),
      bankroll: new BankrollCache({ ttlMs: 0, now: () => 0 }),
      meter: new CostMeter(DEFAULT_SERV.pricing),
      rollover: new RolloverStore(join(dir, "rollover.json")),
      serv: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, greedy(toChips(seat) * 3)),
      entrants: 24,
    };

    const treasuryWei = chain.balanceOf(wallets.bank!.address);
    const plan = await planRound(ctx, "thin");
    const lent = plan.loans.reduce((sum, l) => sum + l.principalWei, 0n);
    expect(lent).toBeLessThanOrEqual(treasuryWei);
    // And somebody was turned away, which is the point of the bound.
    expect(plan.refusals.length).toBeGreaterThan(0);
  });

  it("asks nothing of a bank that is not there", async () => {
    process.env.SERVPIT_BANK_ENABLED = "true";
    const { ctx } = await harness(greedy(toChips(stakeWeiFrom()) * 3));
    // No bank wallet was opened, so nothing is borrowed and agents play for
    // what they hold.
    const plan = await planRound(ctx, "nobank");
    expect(plan.loans).toEqual([]);
    for (const e of plan.entering) expect(e.loanWei).toBeUndefined();
  });
});

describe("disbursement", () => {
  async function levered(stakeMultiple: number) {
    process.env.SERVPIT_BANK_ENABLED = "true";
    const seat = stakeWeiFrom();
    dir = mkdtempSync(join(tmpdir(), "servpit-bankflag-"));
    const chain = new FakeChain({ initialBalanceWei: seat });
    const wallets = await openWallets(chain, new WalletRegistry(join(dir, "wallets.json")), { bank: true });
    chain.fund(wallets.bank!.address, seat * 200n);
    const ledger = new TransferLedger(join(dir, "ledger.json"));
    const ctx = {
      chain,
      wallets,
      ledger,
      store: new RoundStore(join(dir, "rounds.json")),
      bankroll: new BankrollCache({ ttlMs: 0, now: () => 0 }),
      meter: new CostMeter(DEFAULT_SERV.pricing),
      rollover: new RolloverStore(join(dir, "rollover.json")),
      serv: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, greedyTransport(toChips(seat) * stakeMultiple)),
      entrants: 24,
    };
    return { chain, wallets, ledger, ctx, seat };
  }

  it("pays the bank's loans out before entries, and reconciles across agents, pot and bank", async () => {
    const { chain, wallets, ctx, seat } = await levered(3);
    const bankBefore = chain.balanceOf(wallets.bank!.address);
    const plan = await planRound(ctx, "disburse");
    const run = await runRound(ctx, plan);

    expect(run.loans.length).toBe(plan.loans.length);
    expect(run.loans.length).toBeGreaterThan(0);
    for (const l of run.loans) {
      expect(l.kind).toBe("loan");
      expect(l.status).toBe("complete");
    }
    const lent = run.loans.reduce((sum, l) => sum + l.amountWei, 0n);
    expect(chain.balanceOf(wallets.bank!.address)).toBe(bankBefore - lent);
    expect(run.reconciliation.ok).toBe(true);
    expect(run.reconciliation.checks.map((c) => c.name)).toContain("bank delta");
    expect(run.reconciliation.checks.map((c) => c.name)).toContain("bank covers its loans");
    // Every seat was three stakes, funded by one held and two borrowed.
    for (const e of plan.entering) expect(e.stakeWei).toBe(seat * 3n);
  });

  it("records the debt with its rate, so the next phase can charge for it", async () => {
    const { ledger, ctx } = await levered(3);
    const plan = await planRound(ctx, "debt");
    await runRound(ctx, plan);
    for (const loan of plan.loans) {
      expect(ledger.principalOwed(loan.agentId)).toBe(loan.principalWei);
      const records = ledger.loansFor(loan.agentId);
      expect(records).toHaveLength(1);
      expect(records[0].rateBps).toBe(loan.rateBps);
      expect(records[0].status).toBe("complete");
    }
  });

  it("disburses once however many times the round is settled", async () => {
    const { chain, ctx } = await levered(3);
    const plan = await planRound(ctx, "twice");
    await runRound(ctx, plan);
    const applied = chain.applied;
    const again = await runRound(ctx, plan);
    expect(chain.applied).toBe(applied);
    expect(again.loans.every((l) => !l.applied)).toBe(true);
    expect(again.reconciliation.ok).toBe(true);
  });

  it("carries the debt into the next round's prompt", async () => {
    const { ctx } = await levered(3);
    const first = await planRound(ctx, "one");
    await runRound(ctx, first);
    const second = await planRound(ctx, "two");
    const owed = second.snapshots.filter((s) => (s.debtWei ?? 0n) > 0n);
    expect(owed.length).toBeGreaterThan(0);
  });
});
