// Retiring an agent only when its seat can be refilled.
//
// The loop these stop: an empty bank refuses every short agent, the settle
// retires each one for being refused, and an empty operator seats the
// replacement with nothing, in the same wallet, so the next round does it
// again. On Base Sepolia that wrote 89,785 retirements in six weeks.
//
// Real plan and settle against the fake chain. The lender is a stubbed
// transport, so no model is reached.

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NAMED_AGENTS } from "@/config/agents";
import { DEFAULT_SERV } from "@/config/serv";
import { seatRefillWei, stakeWeiFrom, toChips } from "@/config/stake";
import { BankrollCache } from "../bankroll";
import { TransferLedger } from "../ledger";
import { CostMeter, ServClient, type ChatTransport } from "../serv/client";
import { FakeChain } from "../wallets/fake";
import { openWallets } from "../wallets/open";
import { WalletRegistry } from "../wallets/registry";
import { fundingCheck } from "../arena/funding";
import { DebtStore } from "./debt";
import { planRound, runRound } from "./flow";
import { RolloverStore } from "./rollover";
import { retirementHeld } from "./settle";
import { RoundStore } from "./store";
import { WreckStore, type WreckRecord } from "./wrecks";

let dir: string;
afterEach(() => {
  delete process.env.SERVPIT_BANK_ENABLED;
  delete process.env.SERVPIT_RETIREMENTS_PER_HOUR;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A lender that always says no, and agents that always want in. */
const refusing = (stakeChips: number): ChatTransport =>
  ({
    create: vi.fn().mockImplementation(async (req: { messages: Array<{ content: string }> }) => {
      const asked = req.messages[1].content;
      const content = asked.includes("wants to put up") ? JSON.stringify({ approve: false, amount: 0, rateBps: 500, reason: "Not today." }) : JSON.stringify({ enter: true, stake: stakeChips, reason: "In." });
      return { model: "stub", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: {} };
    }),
  }) as unknown as ChatTransport;

/**
 * Six agents short of a seat, a bank and an operator holding what a test
 * says. The agents hold what the live ones did: twenty chips against a ten
 * chip seat and a twenty chip reserve.
 */
async function pit(options: { bankWei: bigint; operatorWei: bigint | null; lender?: "refuses" | "heuristic"; agentWei?: bigint }) {
  process.env.SERVPIT_BANK_ENABLED = "true";
  const seat = stakeWeiFrom();
  dir = mkdtempSync(join(tmpdir(), "servpit-retire-"));
  const chain = new FakeChain({ initialBalanceWei: 0n, gasReserveWei: seat * 2n });
  const wallets = await openWallets(chain, new WalletRegistry(join(dir, "wallets.json"), "fake"), { bank: true, operator: options.operatorWei !== null });
  for (const agent of wallets.agents.values()) chain.fund(agent.address, options.agentWei ?? seat * 2n);
  chain.fund(wallets.pot.address, seat * 100n);
  chain.fund(wallets.bank!.address, options.bankWei);
  if (wallets.operator && options.operatorWei !== null) chain.fund(wallets.operator.address, options.operatorWei);
  const wreckFile = join(dir, "wrecks-fake.json");
  const ctx = {
    chain,
    wallets,
    ledger: new TransferLedger(join(dir, "ledger.json"), "fake"),
    store: new RoundStore(join(dir, "rounds.json"), "fake"),
    bankroll: new BankrollCache({ ttlMs: 0, now: () => 0 }),
    meter: new CostMeter(DEFAULT_SERV.pricing),
    rollover: new RolloverStore(join(dir, "rollover.json"), "fake"),
    debts: new DebtStore(join(dir, "debts.json"), "fake"),
    wreckStore: new WreckStore(wreckFile, "fake"),
    ...(options.lender === "heuristic" ? {} : { serv: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, refusing(toChips(seat))) }),
    entrants: 24,
  };
  return { chain, wallets, ctx, seat, wreckFile };
}

const graveyardFiles = (): string[] => readdirSync(dir).filter((f) => f.startsWith("wrecks-fake"));

const identities = (ctx: Awaited<ReturnType<typeof pit>>["ctx"]): string[] => NAMED_AGENTS.map((a) => ctx.debts.currentIdentity(a.id));

describe("a pit with no money to refill a seat", () => {
  it("retires nobody and replaces nobody while the bank and operator are empty", async () => {
    // Under a seat, so every agent goes straight to the bank, which has nothing.
    const { ctx, chain, wallets } = await pit({ bankWei: 0n, operatorWei: 0n, lender: "heuristic", agentWei: stakeWeiFrom() / 2n });
    const before = identities(ctx);
    const plan = await planRound(ctx, "broke-1");
    // The bank has nothing, so every short agent is refused.
    expect(plan.deniedCredit).toHaveLength(6);

    const run = await runRound(ctx, plan);
    expect(run.wrecks).toEqual([]);
    expect(run.replacements).toEqual([]);
    expect(run.seizures).toEqual([]);
    expect(run.held).toHaveLength(6);
    for (const h of run.held) expect(h).toMatchObject({ trigger: "broke and denied credit", why: "operator short" });
    // Nothing written to the graveyard, nobody new in any seat.
    expect(graveyardFiles()).toEqual([]);
    expect(identities(ctx)).toEqual(before);
    expect(chain.balanceOf(wallets.operator!.address)).toBe(0n);
    expect(run.reconciliation.ok).toBe(true);
  });

  it("never cycles a seat, however many broke rounds are played", async () => {
    const { ctx } = await pit({ bankWei: 0n, operatorWei: 0n, lender: "heuristic", agentWei: stakeWeiFrom() / 2n });
    const before = identities(ctx);
    for (let i = 0; i < 4; i++) {
      const run = await runRound(ctx, await planRound(ctx, `broke-loop-${i}`));
      expect(run.wrecks).toEqual([]);
      expect(run.replacements).toEqual([]);
    }
    expect(ctx.wreckStore.all()).toEqual([]);
    expect(identities(ctx)).toEqual(before);
  });

  it("never sends part of a refill, which seats an agent that is short already", async () => {
    const partial = seatRefillWei(stakeWeiFrom()) / 2n;
    const { ctx, chain, wallets } = await pit({ bankWei: stakeWeiFrom() * 200n, operatorWei: partial });
    const run = await runRound(ctx, await planRound(ctx, "part-refill"));
    expect(run.replacements).toEqual([]);
    for (const h of run.held) expect(h.why).toBe("operator short");
    expect(chain.balanceOf(wallets.operator!.address)).toBe(partial);
  });

  it("holds every retirement when there is no operator wallet to refill from", async () => {
    const { ctx } = await pit({ bankWei: stakeWeiFrom() * 200n, operatorWei: null });
    const run = await runRound(ctx, await planRound(ctx, "no-operator"));
    expect(run.wrecks).toEqual([]);
    expect(run.held.length).toBeGreaterThan(0);
    for (const h of run.held) expect(h.why).toBe("no operator");
  });

  it("retires as many as the operator can refill in full, and holds the rest", async () => {
    const refill = seatRefillWei(stakeWeiFrom());
    const reserve = stakeWeiFrom() * 2n;
    const { ctx, chain, wallets } = await pit({ bankWei: stakeWeiFrom() * 200n, operatorWei: refill * 2n + reserve });
    const run = await runRound(ctx, await planRound(ctx, "two-refills"));
    expect(run.replacements).toHaveLength(2);
    for (const r of run.replacements) expect(r.fundedWei).toBe(refill);
    expect(run.held).toHaveLength(4);
    expect(chain.balanceOf(wallets.operator!.address)).toBe(reserve);
    expect(ctx.wreckStore.all()).toHaveLength(2);
  });
});

describe("the hourly cap on retirements", () => {
  it("retires up to the cap, holds the rest, and the next round's check holds the pit", async () => {
    process.env.SERVPIT_RETIREMENTS_PER_HOUR = "2";
    const { ctx, wallets } = await pit({ bankWei: stakeWeiFrom() * 200n, operatorWei: stakeWeiFrom() * 500n });
    const run = await runRound(ctx, await planRound(ctx, "capped"));
    expect(run.wrecks).toHaveLength(2);
    expect(run.held).toHaveLength(4);
    for (const h of run.held) expect(h.why).toBe("limit");

    const report = await fundingCheck({ chain: ctx.chain, wallets, bankroll: ctx.bankroll, flow: { rollover: ctx.rollover, wreckStore: ctx.wreckStore } } as never);
    expect(report.ok).toBe(false);
    expect(report.holdKind).toBe("retirements");
    expect(report.retirements).toEqual({ lastHour: 2, cap: 2 });
  });

  it("counts the last hour only", async () => {
    process.env.SERVPIT_RETIREMENTS_PER_HOUR = "2";
    const { ctx } = await pit({ bankWei: stakeWeiFrom() * 200n, operatorWei: stakeWeiFrom() * 500n });
    // Two retirements an hour and a half ago leave the hour empty.
    const old = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    for (const walletId of ["zed-1", "zed-2"]) ctx.wreckStore.save(record({ walletId, at: old, roundId: `r-old-${walletId}` }));
    const run = await runRound(ctx, await planRound(ctx, "old-ones"));
    expect(run.wrecks).toHaveLength(2);
  });
});

describe("the same seat twice in one hour", () => {
  it("is held when the agent sat there since has not played a round", async () => {
    const { ctx } = await pit({ bankWei: stakeWeiFrom() * 200n, operatorWei: stakeWeiFrom() * 500n });
    // Atlas's seat was emptied ten minutes ago in a round this store never
    // saw, and its new agent has not entered anything since.
    ctx.wreckStore.save(record({ walletId: "atlas", at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), roundId: "r-earlier" }));
    const run = await runRound(ctx, await planRound(ctx, "cycle"));
    expect(run.held.find((h) => h.walletId === "atlas")?.why).toBe("cycle");
    expect(run.wrecks.map((w) => w.walletId)).not.toContain("atlas");
    expect(run.wrecks.length).toBe(5);
  });
});

describe("the order a retirement is held in", () => {
  const gate = { hasOperator: true, spareWei: 10n, refillWei: 10n, retiredThisHour: 0, cap: 12, playedSince: () => true };
  it("goes ahead only when every condition holds", () => {
    expect(retirementHeld(gate)).toBeNull();
    expect(retirementHeld({ ...gate, hasOperator: false })).toBe("no operator");
    expect(retirementHeld({ ...gate, spareWei: 9n })).toBe("operator short");
    expect(retirementHeld({ ...gate, retiredThisHour: 12 })).toBe("limit");
    expect(retirementHeld({ ...gate, playedSince: () => false })).toBe("cycle");
  });

  it("reads the round store only when the cheaper reasons have all said yes", () => {
    const playedSince = vi.fn(() => true);
    retirementHeld({ ...gate, spareWei: 0n, playedSince });
    expect(playedSince).not.toHaveBeenCalled();
  });
});

function record(extra: Partial<WreckRecord>): WreckRecord {
  return {
    roundId: "r-x",
    walletId: "atlas",
    identityId: "atlas-2",
    name: "Atlas",
    face: null,
    trigger: "broke and denied credit",
    balanceAtDeathWei: "0",
    debtAtDeathWei: "0",
    principalAtDeathWei: "0",
    interestAtDeathWei: "0",
    seizedWei: "0",
    writtenOffWei: "0",
    peakBalanceWei: "0",
    borrowedWei: "0",
    loanCount: 0,
    recentStakeMultiples: [],
    roundsSurvived: 1,
    wins: 0,
    at: new Date().toISOString(),
    ...extra,
  };
}

it("leaves no graveyard file behind a held round", async () => {
  await pit({ bankWei: 0n, operatorWei: 0n, lender: "heuristic" });
  expect(existsSync(join(dir, "wrecks-fake.ndjson"))).toBe(false);
});
