import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SERV } from "@/config/serv";
import { BankrollCache } from "../bankroll";
import { TransferLedger } from "../ledger";
import { CostMeter, ServClient, type ChatTransport } from "../serv/client";
import { FakeChain } from "../wallets/fake";
import { openWallets } from "../wallets/open";
import { WalletRegistry } from "../wallets/registry";
import { RoundStore } from "./store";
import { planRound, runRound } from "./flow";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const enterTransport = () =>
  ({
    create: vi.fn().mockResolvedValue({
      model: "claude-haiku-4.5",
      // The stake is derived, so the fixture states it rather than hardcoding
      // a number that stops being this round's allocation.
      // Chips, and a reason in the register the validator now requires.
      choices: [{ index: 0, message: { role: "assistant", content: `{"enter":true,"stake":${toChips(stakeWeiFrom())},"reason":"Plenty in the tank, I am in."}` }, finish_reason: "stop" }],
      usage: { prompt_tokens: 800, completion_tokens: 60, total_tokens: 860 },
    }),
  }) as unknown as ChatTransport;

async function harness(options: { balanceWei?: bigint; transport?: ChatTransport; gasReserveWei?: bigint } = {}) {
  dir = mkdtempSync(join(tmpdir(), "servpit-round-"));
  const chain = new FakeChain({ initialBalanceWei: options.balanceWei ?? FUNDED_WEI, gasReserveWei: options.gasReserveWei });
  const registry = new WalletRegistry(join(dir, "wallets.json"));
  const wallets = await openWallets(chain, registry);
  const ledger = new TransferLedger(join(dir, "ledger.json"));
  const store = new RoundStore(join(dir, "rounds.json"));
  const bankroll = new BankrollCache({ ttlMs: 0, now: () => 0 });
  const meter = new CostMeter(DEFAULT_SERV.pricing);
  const client = options.transport ? new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, options.transport) : undefined;
  return { chain, wallets, ledger, store, bankroll, meter, ctx: { chain, wallets, ledger, store, bankroll, meter, serv: client, entrants: 24 } };
}

import { stakeWeiFrom, toChips } from "@/config/stake";

/** What a wallet is funded with, which the stake is a tenth of. */
const FUNDED_WEI = 100_000_000_000_000n;

describe("planRound", () => {
  it("decides for all six named agents and fills the field to the requested size with bots", async () => {
    const { ctx } = await harness({ transport: enterTransport() });
    const plan = await planRound(ctx, "demo");
    expect(plan.decisions).toHaveLength(6);
    expect(plan.decisions.every((d) => d.source === "serv")).toBe(true);
    expect(plan.entrants).toHaveLength(24);
    expect(plan.bots.length).toBe(24 - plan.entering.length);
    expect(new Set(plan.entrants.map((e) => e.id)).size).toBe(24);
    for (const e of plan.entrants) expect(e.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it("reads bankroll from chain for every agent", async () => {
    const { ctx, chain } = await harness({ transport: enterTransport() });
    const before = chain.balanceReads;
    const plan = await planRound(ctx, "demo");
    expect(chain.balanceReads).toBeGreaterThanOrEqual(before + 6);
    for (const d of plan.decisions) expect(d.balanceWei).toBe(FUNDED_WEI);
  });

  it("excludes a broke agent from entry no matter what it decided", async () => {
    const { ctx, chain, wallets } = await harness({ transport: enterTransport() });
    const atlas = wallets.agents.get("atlas")!;
    const pot = wallets.pot;
    await atlas.send([{ to: pot.address, value: (await atlas.getBalance()) - 10n }], "drain-atlas");
    ctx.bankroll.invalidate();
    const plan = await planRound(ctx, "demo");
    expect(plan.entering.map((e) => e.agentId)).not.toContain("atlas");
    const atlasDecision = plan.decisions.find((d) => d.agentId === "atlas")!;
    expect(atlasDecision.decision.enter).toBe(false);
    // Drained to 10 wei, which is no chips at all, so the model's answer is
    // refused on the balance before the exclusion path is even reached.
    expect(atlasDecision.rejection ?? "").toMatch(/chips|short on/i);
    expect(chain.balanceReads).toBeGreaterThan(0);
  });

  it("is deterministic per seed for the bot field", async () => {
    const a = await harness({ transport: enterTransport() });
    const planA = await planRound(a.ctx, "demo");
    const b = await harness({ transport: enterTransport() });
    const planB = await planRound(b.ctx, "demo");
    expect(planA.bots).toEqual(planB.bots);
    expect(planA.roundId).toBe(planB.roundId);
  });

  it("uses the heuristic for every agent when SERV is absent, and the plan still works", async () => {
    const { ctx } = await harness();
    const plan = await planRound(ctx, "demo");
    expect(plan.decisions.every((d) => d.source === "heuristic")).toBe(true);
    expect(plan.entrants).toHaveLength(24);
  });
});

describe("runRound", () => {
  it("collects entries, resolves, pays the winner and reconciles against chain balances", async () => {
    const { ctx, wallets, chain } = await harness({ transport: enterTransport() });
    const plan = await planRound(ctx, "demo");
    const result = await runRound(ctx, plan);

    expect(result.entries).toHaveLength(plan.entering.length);
    for (const e of result.entries) expect(e.status).toBe("complete");
    expect(result.round.placements).toHaveLength(24);
    expect(result.reconciliation.ok).toBe(true);
    expect(result.reconciliation.checks.every((c) => c.ok)).toBe(true);

    const winner = result.round.placements[0];
    const prize = result.round.pot - result.round.rake;
    if (plan.entering.some((e) => e.entrantId === winner)) {
      expect(result.payout?.amountWei).toBe(BigInt(prize));
      expect(result.payout?.status).toBe("complete");
    } else {
      expect(result.payout).toBeNull();
      expect(chain.balanceOf(wallets.pot.address)).toBeGreaterThan(0n);
    }
  });

  it("is idempotent: running the same round twice transfers once", async () => {
    const { ctx, chain } = await harness({ transport: enterTransport() });
    const plan = await planRound(ctx, "demo");
    await runRound(ctx, plan);
    const applied = chain.applied;
    const again = await runRound(ctx, plan);
    expect(chain.applied).toBe(applied);
    expect(again.reconciliation.ok).toBe(true);
  });

  it("records the round so the reasoning surface can show bankroll change", async () => {
    const { ctx } = await harness({ transport: enterTransport() });
    const plan = await planRound(ctx, "demo");
    const result = await runRound(ctx, plan);
    const stored = ctx.store.get(plan.roundId)!;
    expect(stored.roundId).toBe(plan.roundId);
    expect(stored.agents).toHaveLength(6);
    for (const a of stored.agents) {
      expect(typeof a.balanceBeforeWei).toBe("string");
      expect(typeof a.balanceAfterWei).toBe("string");
      expect(a.reason.length).toBeGreaterThan(0);
    }
    expect(result.round.log.length).toBeGreaterThan(0);
    expect(stored.winner).toBe(result.round.placements[0]);
  });

  it("feeds the previous round's outcome into the next plan", async () => {
    const { ctx } = await harness({ transport: enterTransport() });
    const first = await planRound(ctx, "demo");
    await runRound(ctx, first);
    const second = await planRound(ctx, "demo2");
    expect(second.snapshots.some((s) => s.recentOutcomes.length > 0)).toBe(true);
  });

  it("never pays out more than the pot minus rake", async () => {
    const { ctx } = await harness({ transport: enterTransport() });
    const plan = await planRound(ctx, "demo");
    const result = await runRound(ctx, plan);
    const paid = result.payout ? result.payout.amountWei : 0n;
    expect(paid).toBeLessThanOrEqual(BigInt(result.round.pot - result.round.rake));
  });
});

describe("gas is no longer sponsored", () => {
  it("excludes an agent that can cover the stake but not the gas, by the same path as a broke one", async () => {
    const { ctx } = await harness({ transport: enterTransport(), gasReserveWei: 500n });
    const atlas = ctx.wallets.agents.get("atlas")!;
    // Leave exactly the stake, nothing for gas. The stake is a tenth of a
    // funded wallet rather than a flat amount, so it is read rather than
    // written down here.
    const stake = stakeWeiFrom();
    await atlas.send([{ to: ctx.wallets.pot.address, value: (await atlas.getBalance()) - stake }], "leave-stake-only");
    ctx.bankroll.invalidate();
    const plan = await planRound(ctx, "gas");
    const atlasDecision = plan.decisions.find((d) => d.agentId === "atlas")!;
    expect(atlasDecision.decision.enter).toBe(false);
    expect(atlasDecision.rejection ?? "").toMatch(/short on gas/);
    expect(plan.entering.map((e) => e.agentId)).not.toContain("atlas");
  });

  it("lets the same agent in once it holds the stake plus the reserve", async () => {
    const { ctx } = await harness({ transport: enterTransport(), gasReserveWei: 500n });
    const plan = await planRound(ctx, "gas2");
    expect(plan.entering.map((e) => e.agentId)).toContain("atlas");
  });
});
