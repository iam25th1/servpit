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
import { DebtStore } from "./debt";
import { WreckStore } from "./wrecks";
import { RoundStore } from "./store";
import { planRound, runRound, seatOccupants } from "./flow";
import { TAPPED_OUT } from "./plan";
import { overReached } from "./wrecks";
import { NAMED_AGENTS } from "@/config/agents";
import { ORIGINAL_FACES, REPLACEMENTS } from "@/config/replacements";
import { totalOwed } from "./debt";

const FUNDED_WEI = 100_000_000_000_000n;
let dir: string;

beforeEach(() => {
  delete process.env.SERVPIT_BANK_ENABLED;
});

afterEach(() => {
  delete process.env.SERVPIT_BANK_ENABLED;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/**
 * Answers both questions in the round: the agent's stake and the bank's loan.
 *
 * One transport serves both because one SERV client does, and the prompts are
 * distinguishable: only the lender is told somebody "wants to put up".
 */
const duplexTransport = (stakeChips: number, loan: { approve: boolean; amount: number; rateBps: number } = { approve: true, amount: 20, rateBps: 1_200 }): ChatTransport =>
  ({
    create: vi.fn().mockImplementation(async (req: { messages: Array<{ content: string }> }) => {
      const asked = req.messages[1].content;
      const content = asked.includes("wants to put up")
        ? JSON.stringify({ ...loan, amount: loan.approve ? loan.amount : 0, reason: loan.approve ? "You are good for it, so far." : "Settle what you owe me first." })
        : JSON.stringify({ enter: true, stake: stakeChips, reason: "Feeling good, going big." });
      return { model: "claude-haiku-4.5", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 420, completion_tokens: 31, total_tokens: 451 } };
    }),
  }) as unknown as ChatTransport;

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
      debts: new DebtStore(join(dir, "debts.json")),
      wreckStore: new WreckStore(join(dir, "wrecks.json")),
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
      debts: new DebtStore(join(dir, "debts.json")),
      wreckStore: new WreckStore(join(dir, "wrecks.json")),
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
      debts: new DebtStore(join(dir, "debts.json")),
      wreckStore: new WreckStore(join(dir, "wrecks.json")),
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
      debts: new DebtStore(join(dir, "debts.json")),
      wreckStore: new WreckStore(join(dir, "wrecks.json")),
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

describe("interest and repayment", () => {
  async function levered(stakeMultiple: number) {
    process.env.SERVPIT_BANK_ENABLED = "true";
    const seat = stakeWeiFrom();
    dir = mkdtempSync(join(tmpdir(), "servpit-bankflag-"));
    const chain = new FakeChain({ initialBalanceWei: seat });
    const wallets = await openWallets(chain, new WalletRegistry(join(dir, "wallets.json")), { bank: true });
    chain.fund(wallets.bank!.address, seat * 200n);
    const debts = new DebtStore(join(dir, "debts.json"));
    const ctx = {
      chain,
      wallets,
      ledger: new TransferLedger(join(dir, "ledger.json")),
      store: new RoundStore(join(dir, "rounds.json")),
      bankroll: new BankrollCache({ ttlMs: 0, now: () => 0 }),
      meter: new CostMeter(DEFAULT_SERV.pricing),
      rollover: new RolloverStore(join(dir, "rollover.json")),
      debts,
      wreckStore: new WreckStore(join(dir, "wrecks.json")),
      serv: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, duplexTransport(toChips(seat) * stakeMultiple)),
      entrants: 24,
    };
    return { chain, wallets, debts, ctx, seat };
  }

  it("charges interest once a round on what is owed, whether or not the agent played", async () => {
    const { debts, ctx } = await levered(3);
    const first = await planRound(ctx, "int1");
    await runRound(ctx, first);
    const borrowed = first.loans[0];
    expect(borrowed).toBeDefined();
    const owedAfterLoan = debts.get(borrowed.agentId, debts.currentIdentity(borrowed.agentId));
    expect(owedAfterLoan.principalWei).toBe(borrowed.principalWei);
    expect(owedAfterLoan.interestWei).toBe(0n);

    // A second round charges for carrying it.
    const second = await planRound(ctx, "int2");
    const run = await runRound(ctx, second);
    expect(run.interest.length).toBeGreaterThan(0);
    const charged = run.interest.find((i) => i.agentId === borrowed.agentId)!;
    expect(charged.chargedWei).toBe((borrowed.principalWei * BigInt(borrowed.rateBps)) / 10_000n);
  });

  it("charges once however many times the round is settled", async () => {
    const { debts, ctx } = await levered(3);
    const first = await planRound(ctx, "once1");
    await runRound(ctx, first);
    const second = await planRound(ctx, "once2");
    await runRound(ctx, second);
    const agentId = first.loans[0].agentId;
    const owed = debts.get(agentId, debts.currentIdentity(agentId)).interestWei;
    const again = await runRound(ctx, second);
    expect(debts.get(agentId, debts.currentIdentity(agentId)).interestWei).toBe(owed);
    expect(again.interest).toEqual([]);
    expect(again.reconciliation.ok).toBe(true);
  });

  it("hands a winner's chips to the bank before it keeps any, interest first", async () => {
    // The debt is put on the books directly rather than borrowed into
    // existence. An agent that borrows to stake everything is broke the next
    // round and never plays again, so waiting for the dynamics to produce an
    // indebted winner tests the dynamics rather than the garnishment.
    process.env.SERVPIT_BANK_ENABLED = "true";
    const seat = stakeWeiFrom();
    dir = mkdtempSync(join(tmpdir(), "servpit-bankflag-"));
    const chain = new FakeChain({ initialBalanceWei: seat * 20n });
    const wallets = await openWallets(chain, new WalletRegistry(join(dir, "wallets.json")), { bank: true });
    chain.fund(wallets.bank!.address, seat * 200n);
    const debts = new DebtStore(join(dir, "debts.json"));
    const ctx = {
      chain,
      wallets,
      ledger: new TransferLedger(join(dir, "ledger.json")),
      store: new RoundStore(join(dir, "rounds.json")),
      bankroll: new BankrollCache({ ttlMs: 0, now: () => 0 }),
      meter: new CostMeter(DEFAULT_SERV.pricing),
      rollover: new RolloverStore(join(dir, "rollover.json")),
      debts,
      wreckStore: new WreckStore(join(dir, "wrecks.json")),
      serv: undefined,
      entrants: 24,
    };
    // Everyone owes two seats at ten per cent, so whoever wins is indebted.
    for (const id of ["atlas", "blaze", "comet", "delta", "ember", "flint"]) {
      debts.addLoan(id, debts.currentIdentity(id), seat * 2n, 1_000);
    }

    let garnished: Awaited<ReturnType<typeof runRound>> | null = null;
    for (const s of Array.from({ length: 30 }, (_, i) => `g${i}`)) {
      const plan = await planRound(ctx, s);
      const run = await runRound(ctx, plan);
      expect(run.reconciliation.ok, s).toBe(true);
      if (run.repayment) {
        garnished = run;
        break;
      }
    }
    expect(garnished, "no indebted agent won in thirty rounds").not.toBeNull();

    const r = garnished!.repayment!;
    expect(r.outcome.kind).toBe("repayment");
    expect(r.outcome.to).toBe(wallets.bank!.address);
    expect(r.interestWei + r.principalWei).toBe(r.outcome.amountWei);
    // Interest before principal: nothing goes to principal while interest is
    // still owed.
    const owed = debts.get(r.agentId, debts.currentIdentity(r.agentId));
    if (r.principalWei > 0n) expect(owed.interestWei).toBe(0n);
    expect(garnished!.reconciliation.checks.find((c) => c.name === "bank delta")?.ok).toBe(true);
  });

  it("never repays more than was owed", async () => {
    const { debts, ctx } = await levered(3);
    for (const s of ["m1", "m2", "m3", "m4", "m5", "m6"]) {
      const plan = await planRound(ctx, s);
      const run = await runRound(ctx, plan);
      if (run.repayment) {
        const owed = debts.get(run.repayment.agentId, debts.currentIdentity(run.repayment.agentId));
        expect(owed.principalWei).toBeGreaterThanOrEqual(0n);
        expect(owed.interestWei).toBeGreaterThanOrEqual(0n);
      }
      expect(run.reconciliation.ok).toBe(true);
    }
  }, 30_000);
});

describe("with the bank off, none of this happens", () => {
  it("charges no interest and garnishes nothing", async () => {
    const { ctx } = await harness();
    for (const seed of ["n1", "n2", "n3"]) {
      const plan = await planRound(ctx, seed);
      const run = await runRound(ctx, plan);
      expect(run.interest).toEqual([]);
      expect(run.repayment).toBeNull();
      expect(run.loans).toEqual([]);
      expect(run.reconciliation.ok).toBe(true);
    }
  });
});

describe("a broke agent does not get to sit out quietly", () => {
  /** Everyone opens below a seat, so every agent is tapped out on round one. */
  async function tapped(loan: { approve: boolean; amount: number; rateBps: number }) {
    process.env.SERVPIT_BANK_ENABLED = "true";
    const seat = stakeWeiFrom();
    dir = mkdtempSync(join(tmpdir(), "servpit-bankflag-"));
    const chain = new FakeChain({ initialBalanceWei: seat / 2n });
    const wallets = await openWallets(chain, new WalletRegistry(join(dir, "wallets.json")), { bank: true });
    chain.fund(wallets.bank!.address, seat * 200n);
    const debts = new DebtStore(join(dir, "debts.json"));
    const wreckStore = new WreckStore(join(dir, "wrecks.json"));
    const ctx = {
      chain,
      wallets,
      ledger: new TransferLedger(join(dir, "ledger.json")),
      store: new RoundStore(join(dir, "rounds.json")),
      bankroll: new BankrollCache({ ttlMs: 0, now: () => 0 }),
      meter: new CostMeter(DEFAULT_SERV.pricing),
      rollover: new RolloverStore(join(dir, "rollover.json")),
      debts,
      wreckStore,
      serv: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, duplexTransport(toChips(seat), loan)),
      entrants: 24,
    };
    return { chain, wallets, debts, wreckStore, ctx, seat };
  }

  it("asks the bank without a model call, in the same plain words every time", async () => {
    const { ctx } = await tapped({ approve: true, amount: 10, rateBps: 900 });
    const plan = await planRound(ctx, "tapped");
    for (const d of plan.decisions) {
      expect(d.decision.reason).toBe(TAPPED_OUT);
      // No agent call was spent on a decision there is nothing to make.
      expect(d.source).toBe("heuristic");
    }
    expect(plan.loans.length).toBe(6);
    expect(plan.deniedCredit).toEqual([]);
  });

  it("is finished when the bank says no, rather than quietly sitting out", async () => {
    // This is the gap the simulation left open: an agent that never asks is
    // never denied, and an agent that is never denied is never wrecked.
    const { ctx, wreckStore } = await tapped({ approve: false, amount: 0, rateBps: 500 });
    const plan = await planRound(ctx, "denied");
    expect(plan.deniedCredit.length).toBe(6);

    const run = await runRound(ctx, plan);
    expect(run.wrecks.length).toBe(6);
    for (const w of run.wrecks) expect(w.trigger).toBe("broke and denied credit");
    expect(wreckStore.all()).toHaveLength(6);
    expect(run.reconciliation.ok).toBe(true);
  });

  it("takes what is left and writes off the rest, into the bank's books", async () => {
    const { chain, wallets, debts, ctx, seat } = await tapped({ approve: false, amount: 0, rateBps: 500 });
    // Put a debt on them that their half seat cannot cover.
    for (const id of ["atlas", "blaze", "comet", "delta", "ember", "flint"]) {
      debts.addLoan(id, debts.currentIdentity(id), seat * 3n, 1_000);
    }
    const bankBefore = chain.balanceOf(wallets.bank!.address);
    const plan = await planRound(ctx, "seize");
    const run = await runRound(ctx, plan);

    expect(run.seizures.length).toBeGreaterThan(0);
    const seized = run.seizures.reduce((sum, s) => sum + s.amountWei, 0n);
    expect(chain.balanceOf(wallets.bank!.address)).toBe(bankBefore + seized);
    for (const w of run.wrecks) {
      // It took what was there and nothing more, and the rest is written off.
      expect(BigInt(w.seizedWei)).toBeLessThanOrEqual(BigInt(w.debtAtDeathWei));
      expect(BigInt(w.seizedWei) + BigInt(w.writtenOffWei)).toBe(BigInt(w.debtAtDeathWei));
      expect(BigInt(w.writtenOffWei)).toBeGreaterThan(0n);
    }
    expect(run.reconciliation.ok).toBe(true);
  });

  it("records what led there, not only what fired", async () => {
    const { debts, ctx, seat } = await tapped({ approve: false, amount: 0, rateBps: 500 });
    for (const id of ["atlas", "blaze", "comet", "delta", "ember", "flint"]) {
      debts.addLoan(id, debts.currentIdentity(id), seat * 3n, 1_000);
    }
    const plan = await planRound(ctx, "record");
    const run = await runRound(ctx, plan);
    const w = run.wrecks[0];

    expect(w.name.length).toBeGreaterThan(0);
    expect(w.identityId).toMatch(/-\d+$/);
    expect(BigInt(w.principalAtDeathWei)).toBe(seat * 3n);
    // A round of interest was charged before it died, at ten per cent.
    expect(BigInt(w.interestAtDeathWei)).toBe((seat * 3n) / 10n);
    expect(BigInt(w.principalAtDeathWei) + BigInt(w.interestAtDeathWei)).toBe(BigInt(w.debtAtDeathWei));
    expect(typeof w.roundsSurvived).toBe("number");
    expect(typeof w.wins).toBe("number");
    expect(Array.isArray(w.recentStakeMultiples)).toBe(true);
    // Borrowed chips mean it was pushing, whatever the trigger was recorded
    // as, which is what lets a screen say over-reached rather than denied.
    expect(overReached({ ...w, borrowedWei: "1" })).toBe(true);
    expect(overReached({ ...w, borrowedWei: "0", recentStakeMultiples: [1, 1] })).toBe(false);
    expect(overReached({ ...w, borrowedWei: "0", recentStakeMultiples: [1, 3] })).toBe(true);
  });

  it("seizes once however many times the round is settled", async () => {
    const { chain, debts, ctx, seat } = await tapped({ approve: false, amount: 0, rateBps: 500 });
    for (const id of ["atlas", "blaze", "comet", "delta", "ember", "flint"]) {
      debts.addLoan(id, debts.currentIdentity(id), seat * 3n, 1_000);
    }
    const plan = await planRound(ctx, "seizetwice");
    await runRound(ctx, plan);
    const applied = chain.applied;
    const again = await runRound(ctx, plan);
    expect(chain.applied).toBe(applied);
    expect(again.reconciliation.ok).toBe(true);
  });
});

describe("replacement", () => {
  async function doomed() {
    process.env.SERVPIT_BANK_ENABLED = "true";
    const seat = stakeWeiFrom();
    dir = mkdtempSync(join(tmpdir(), "servpit-bankflag-"));
    const chain = new FakeChain({ initialBalanceWei: seat / 2n });
    const wallets = await openWallets(chain, new WalletRegistry(join(dir, "wallets.json")), { bank: true, operator: true });
    chain.fund(wallets.bank!.address, seat * 200n);
    chain.fund(wallets.operator!.address, seat * 500n);
    const debts = new DebtStore(join(dir, "debts.json"));
    const ctx = {
      chain,
      wallets,
      ledger: new TransferLedger(join(dir, "ledger.json")),
      store: new RoundStore(join(dir, "rounds.json")),
      bankroll: new BankrollCache({ ttlMs: 0, now: () => 0 }),
      meter: new CostMeter(DEFAULT_SERV.pricing),
      rollover: new RolloverStore(join(dir, "rollover.json")),
      debts,
      wreckStore: new WreckStore(join(dir, "wrecks.json")),
      serv: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, duplexTransport(toChips(seat), { approve: false, amount: 0, rateBps: 500 })),
      entrants: 24,
    };
    return { chain, wallets, debts, ctx, seat };
  }

  it("puts somebody new in the seat, with a face none of the originals wear", async () => {
    const { ctx } = await doomed();
    const plan = await planRound(ctx, "refill");
    const run = await runRound(ctx, plan);

    expect(run.replacements).toHaveLength(6);
    for (const r of run.replacements) {
      expect(r.identityId).toMatch(/-2$/);
      expect(REPLACEMENTS.some((p) => p.name === r.name)).toBe(true);
      expect(r.face).not.toBeNull();
      expect(ORIGINAL_FACES).not.toContain(r.face);
    }
    expect(run.reconciliation.ok).toBe(true);
  });

  it("gives every emptied seat a different occupant, so no two share a face", async () => {
    // Six seats emptied in one round used to produce six of the same person:
    // the pool was walked by generation, and every seat was on generation two.
    const { ctx } = await doomed();
    const run = await runRound(ctx, await planRound(ctx, "refill"));

    expect(new Set(run.replacements.map((r) => r.occupantId)).size).toBe(run.replacements.length);
    expect(new Set(run.replacements.map((r) => r.name)).size).toBe(run.replacements.length);
    expect(new Set(run.replacements.map((r) => r.face)).size).toBe(run.replacements.length);
  });

  it("shows the replacement in the next round's lineup, never the agent it replaced", async () => {
    const { ctx } = await doomed();
    const dead = await planRound(ctx, "refill");
    const run = await runRound(ctx, dead);
    const replaced = new Map(run.replacements.map((r) => [r.walletId, r]));

    const next = await planRound(ctx, "after-refill");
    for (const decision of next.decisions) {
      const heir = replaced.get(decision.agentId)!;
      expect(decision.name).toBe(heir.name);
      expect(decision.face).toBe(heir.face);
      expect(NAMED_AGENTS.some((original) => original.id === decision.agentId && original.name === decision.name)).toBe(false);
    }
    // And the same thing the lineup panel is handed before anybody decides.
    const seated = seatOccupants(ctx);
    expect(new Set(seated.map((s) => s.face)).size).toBe(seated.length);
    for (const seat of seated) expect(seat.name).toBe(replaced.get(seat.agentId)!.name);
  });

  it("never lets a new agent inherit a dead one's debt", async () => {
    const { debts, ctx, seat } = await doomed();
    for (const id of ["atlas", "blaze", "comet", "delta", "ember", "flint"]) {
      debts.addLoan(id, debts.currentIdentity(id), seat * 3n, 1_000);
    }
    const plan = await planRound(ctx, "clean");
    const run = await runRound(ctx, plan);
    expect(run.wrecks.length).toBe(6);
    for (const w of run.wrecks) {
      expect(BigInt(w.writtenOffWei)).toBeGreaterThan(0n);
      // Same wallet, new identity, nothing owed.
      const identity = debts.currentIdentity(w.walletId);
      expect(identity).not.toBe(w.identityId);
      expect(totalOwed(debts.get(w.walletId, identity))).toBe(0n);
    }
  });

  it("funds the seat from operator capital, never from an agent or the pot", async () => {
    const { chain, wallets, ctx } = await doomed();
    const operatorBefore = chain.balanceOf(wallets.operator!.address);
    const potBefore = chain.balanceOf(wallets.pot.address);
    const plan = await planRound(ctx, "capital");
    const run = await runRound(ctx, plan);

    const funded = run.replacements.reduce((sum, r) => sum + r.fundedWei, 0n);
    expect(funded).toBeGreaterThan(0n);
    expect(chain.balanceOf(wallets.operator!.address)).toBe(operatorBefore - funded);
    // Nobody entered, so the pot is untouched by any of this.
    expect(chain.balanceOf(wallets.pot.address)).toBe(potBefore);
    expect(run.reconciliation.checks.map((c) => c.name)).toContain("operator delta");
    expect(run.reconciliation.ok).toBe(true);
  });

  it("shows the new agent by name in the next round's plan", async () => {
    const { ctx } = await doomed();
    const first = await planRound(ctx, "gen1");
    const names = new Set(first.decisions.map((d) => d.name));
    await runRound(ctx, first);

    const second = await planRound(ctx, "gen2");
    for (const d of second.decisions) {
      expect(names.has(d.name)).toBe(false);
      expect(REPLACEMENTS.some((p) => p.name === d.name)).toBe(true);
      expect(d.face).not.toBeNull();
    }
  });

  it("refills once however many times the round is settled", async () => {
    const { chain, ctx } = await doomed();
    const plan = await planRound(ctx, "refilltwice");
    await runRound(ctx, plan);
    const applied = chain.applied;
    const again = await runRound(ctx, plan);
    expect(chain.applied).toBe(applied);
    expect(again.reconciliation.ok).toBe(true);
  });
});

describe("a loan for a seat that is not taken", () => {
  // The approval is sized to the shortfall, so an agent that gets the whole
  // of it can always afford the seat. An agent that gets part of it, because
  // the ceiling or the treasury capped the answer, is still short: it is
  // excluded, and the chips must not leave the bank for a round it is not in.
  it("is withdrawn rather than disbursed, and the treasury keeps the chips", async () => {
    process.env.SERVPIT_BANK_ENABLED = "true";
    const seat = stakeWeiFrom();
    dir = mkdtempSync(join(tmpdir(), "servpit-withdrawn-"));
    // Empty agents and a reserve of two seats, so a one seat approval is not
    // enough for the smallest stake there is and the gate turns them away.
    const chain = new FakeChain({ initialBalanceWei: 0n, gasReserveWei: seat * 2n });
    const wallets = await openWallets(chain, new WalletRegistry(join(dir, "wallets.json"), "fake"), { bank: true });
    chain.fund(wallets.bank!.address, seat * 100n);
    const bankBefore = chain.balanceOf(wallets.bank!.address);
    const ctx = {
      chain,
      wallets,
      ledger: new TransferLedger(join(dir, "ledger.json"), "fake"),
      store: new RoundStore(join(dir, "rounds.json"), "fake"),
      bankroll: new BankrollCache({ ttlMs: 0, now: () => 0 }),
      meter: new CostMeter(DEFAULT_SERV.pricing),
      rollover: new RolloverStore(join(dir, "rollover.json"), "fake"),
      debts: new DebtStore(join(dir, "debts.json"), "fake"),
      wreckStore: new WreckStore(join(dir, "wrecks.json"), "fake"),
      // Approves a single seat, which is less than the three seat stake the
      // agents are asking to put up.
      serv: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, duplexTransport(toChips(seat) * 3, { approve: true, amount: toChips(seat), rateBps: 500 })),
      entrants: 24,
    };

    const plan = await planRound(ctx, "withdrawn");
    expect(plan.entering).toHaveLength(0);
    expect(plan.loans).toHaveLength(0);

    const run = await runRound(ctx, plan);
    expect(run.loans).toHaveLength(0);
    expect(chain.balanceOf(wallets.bank!.address)).toBe(bankBefore);
    for (const [id] of wallets.agents) expect(totalOwed(ctx.debts.get(id, ctx.debts.currentIdentity(id)))).toBe(0n);
    expect(run.reconciliation.ok).toBe(true);
  });
});