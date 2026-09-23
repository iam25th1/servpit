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
import { RolloverStore } from "./rollover";
import { DebtStore } from "./debt";
import { WreckStore } from "./wrecks";
import { planRound, runRound } from "./flow";
import { UNREACHABLE_REASON } from "./plan";
import { ChainUnreachableError } from "../errors";
import { setServReasoning } from "../serv/switch";

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
  const rollover = new RolloverStore(join(dir, "rollover.json"));
  const debts = new DebtStore(join(dir, "debts.json"));
  const wreckStore = new WreckStore(join(dir, "wrecks.json"));
  const bankroll = new BankrollCache({ ttlMs: 0, now: () => 0 });
  const meter = new CostMeter(DEFAULT_SERV.pricing);
  const client = options.transport ? new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, options.transport) : undefined;
  return { chain, wallets, ledger, store, bankroll, meter, rollover, ctx: { chain, wallets, ledger, store, bankroll, meter, rollover, debts, wreckStore, serv: client, entrants: 24 } };
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

  it("makes no serv call at all while the switch is off, and records instinct", async () => {
    // The point of the switch is that it costs nothing: not a refused call,
    // not a failed one, none at all. The transport is the only place a call
    // can happen, so counting it is the measurement.
    const transport = enterTransport();
    const { ctx } = await harness({ transport });
    const switchFile = join(dir, "serv-off");
    setServReasoning(switchFile, false);
    const plan = await planRound({ ...ctx, servSwitchFile: switchFile }, "demo");
    expect((transport.create as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
    expect(plan.decisions).toHaveLength(6);
    expect(plan.decisions.every((d) => d.source === "heuristic")).toBe(true);
  });

  it("seats a claimed fighter, at no cost to anybody", async () => {
    // A claimed seat is a house seat with a name on it: it is in the field,
    // it pays nothing, it decides nothing, and the field is still 24.
    const { ctx } = await harness({ transport: enterTransport() });
    const fighters = [{ handle: "ash", name: "Cinder", face: "Monk", entrantId: "fighter-ash" }];
    const plan = await planRound({ ...ctx, fighters: () => fighters }, "demo");
    expect(plan.entrants).toHaveLength(24);
    expect(plan.entrants.some((e) => e.id === "fighter-ash")).toBe(true);
    expect(plan.fighters).toEqual(fighters);
    // Not an entry, so no stake, no transfer and nothing to settle.
    expect(plan.entering.some((e) => e.entrantId === "fighter-ash")).toBe(false);
    expect(plan.decisions.some((d) => d.agentId === "ash")).toBe(false);
    // The bots give up the seats the fighters take, rather than the field growing.
    expect(plan.bots).toHaveLength(24 - plan.entering.length - 1);
  });

  it("seats no more fighters than there are seats left", async () => {
    const { ctx } = await harness({ transport: enterTransport() });
    const crowd = Array.from({ length: 40 }, (_, i) => ({ handle: `h${i}`, name: `F${i}`, face: "Monk", entrantId: `fighter-h${i}` }));
    const plan = await planRound({ ...ctx, fighters: () => crowd }, "demo");
    expect(plan.entrants).toHaveLength(24);
    expect(new Set(plan.entrants.map((e) => e.id)).size).toBe(24);
  });

  it("spends nothing on a round that did not ask to reason", async () => {
    // What the arena worker passes for a round the interval started. The
    // transport is the only place a call can happen, so counting it is the
    // measurement.
    const transport = enterTransport();
    const { ctx } = await harness({ transport });
    const plan = await planRound(ctx, "demo", undefined, undefined, { reasoning: false });
    expect((transport.create as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
    expect(plan.decisions.every((d) => d.source === "heuristic")).toBe(true);
    expect(plan.servCalls).toBe(0);
  });

  it("reasons for a round that asked to, which is a round somebody pulled", async () => {
    const transport = enterTransport();
    const { ctx } = await harness({ transport });
    const plan = await planRound(ctx, "demo", undefined, undefined, { reasoning: true });
    expect(plan.decisions.every((d) => d.source === "serv")).toBe(true);
  });

  it("keeps the operator switch as the master, whatever the round asked for", async () => {
    // A pulled round asks to reason. With reasoning off it still does not,
    // and it costs nothing to refuse.
    const transport = enterTransport();
    const { ctx } = await harness({ transport });
    const switchFile = join(dir, "serv-off");
    setServReasoning(switchFile, false);
    const plan = await planRound({ ...ctx, servSwitchFile: switchFile }, "demo", undefined, undefined, { reasoning: true });
    expect((transport.create as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
    expect(plan.decisions.every((d) => d.source === "heuristic")).toBe(true);
  });

  it("asks serv again the moment the switch is back on, with no restart", async () => {
    const transport = enterTransport();
    const { ctx } = await harness({ transport });
    const switchFile = join(dir, "serv-off");
    setServReasoning(switchFile, false);
    await planRound({ ...ctx, servSwitchFile: switchFile }, "demo");
    setServReasoning(switchFile, true);
    const plan = await planRound({ ...ctx, servSwitchFile: switchFile }, "demo");
    expect(plan.decisions.every((d) => d.source === "serv")).toBe(true);
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
    // The prize is what agents paid in plus what rolled over, never the
    // engine's twenty four seat pot.
    const entriesWei = result.entries.reduce((sum, e) => sum + e.amountWei, 0n);
    expect(result.prize.poolWei).toBe(entriesWei + result.rolloverInWei);
    if (plan.entering.some((e) => e.entrantId === winner)) {
      expect(result.payout?.amountWei).toBe(result.prize.poolWei - result.prize.rakeWei);
      expect(result.payout?.status).toBe("complete");
    } else {
      expect(result.payout).toBeNull();
      expect(result.retained?.amountWei).toBe(result.prize.nextRolloverWei);
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
    const entriesWei = result.entries.reduce((sum, e) => sum + e.amountWei, 0n);
    expect(paid).toBeLessThanOrEqual(entriesWei + result.rolloverInWei);
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

describe("the pot only ever pays out what it is holding", () => {
  // The prize used to be the engine's twenty four seat pot while only the
  // five or six real agents paid anything. The pot wallet covered the gap out
  // of its own balance every time an agent won, about ten chips a round, and
  // had one payout left in it when this was measured.
  it("rolls an unclaimed prize into the next round instead of promising it out of the pot's own balance", async () => {
    const { ctx } = await harness({ transport: enterTransport() });
    const outcomes: string[] = [];
    let carried = 0n;
    for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
      const plan = await planRound(ctx, seed);
      const run = await runRound(ctx, plan);
      const entriesWei = run.entries.reduce((sum, e) => sum + e.amountWei, 0n);
      expect(run.rolloverInWei).toBe(carried);
      expect(run.prize.poolWei).toBe(entriesWei + carried);
      expect(run.reconciliation.ok).toBe(true);
      if (run.payout) {
        outcomes.push("agent");
        expect(run.payout.amountWei).toBe(run.prize.poolWei - run.prize.rakeWei);
        expect(run.prize.nextRolloverWei).toBe(0n);
      } else {
        outcomes.push("house");
        expect(run.retained?.amountWei).toBe(run.prize.poolWei - run.prize.rakeWei);
      }
      carried = run.prize.nextRolloverWei;
    }
    // Both branches have to be exercised or the invariant is only half tested.
    expect(new Set(outcomes).size).toBe(2);
  });

  it("never sends the bank a share while there is no bank wallet", async () => {
    const { ctx } = await harness({ transport: enterTransport() });
    const plan = await planRound(ctx, "bank");
    const run = await runRound(ctx, plan);
    expect(run.prize.toBankWei).toBe(0n);
  });

  it("gives a replayed round the same rollover and pays nothing a second time", async () => {
    const { ctx, chain } = await harness({ transport: enterTransport() });
    const plan = await planRound(ctx, "replay");
    const first = await runRound(ctx, plan);
    const applied = chain.applied;
    const again = await runRound(ctx, plan);
    expect(again.rolloverInWei).toBe(first.rolloverInWei);
    expect(again.prize.poolWei).toBe(first.prize.poolWei);
    expect(ctx.rollover.carriedWei).toBe(first.prize.nextRolloverWei);
    expect(chain.applied).toBe(applied);
    expect(again.reconciliation.ok).toBe(true);
  });
});

describe("an unreachable wallet costs one agent its round, not the whole round", () => {
  /** A wallet whose balance read always fails, standing in for a dead endpoint. */
  const breakWallet = (ctx: { wallets: { agents: Map<string, { address: string; getBalance: () => Promise<bigint>; send: unknown }> } }, agentId: string): void => {
    const wallet = ctx.wallets.agents.get(agentId)!;
    ctx.wallets.agents.set(agentId, { ...wallet, getBalance: async () => { throw new Error("The request took too long to respond. URL: https://rpc.example/key"); } } as never);
  };

  it("keeps going with the rest when one endpoint cannot answer for one wallet", async () => {
    const { ctx } = await harness({ transport: enterTransport() });
    // The chain answers for everyone except atlas, which is what multicall
    // with allowFailure produces when one address comes back unsuccessful.
    const atlas = ctx.wallets.agents.get("atlas")!.address;
    const chain = ctx.chain;
    const partial = {
      ...chain,
      getBalances: async (addresses: readonly string[]) => {
        const all = await chain.getBalances(addresses);
        delete all[atlas];
        return all;
      },
    };
    breakWallet(ctx as never, "atlas");
    const plan = await planRound({ ...ctx, chain: partial as never }, "onedead");

    expect(plan.decisions).toHaveLength(6);
    const atlasDecision = plan.decisions.find((d) => d.agentId === "atlas")!;
    expect(atlasDecision.decision.enter).toBe(false);
    expect(atlasDecision.decision.reason).toBe(UNREACHABLE_REASON);
    expect(plan.entering.map((e) => e.agentId)).not.toContain("atlas");
    // The other five still decided, and the round still has a full field.
    expect(plan.decisions.filter((d) => d.source === "serv")).toHaveLength(5);
    expect(plan.entrants).toHaveLength(24);
  });

  it("reports an unreachable agent straight away rather than leaving it thinking", async () => {
    const { ctx } = await harness({ transport: enterTransport() });
    breakWallet(ctx as never, "comet");
    const seen: string[] = [];
    await planRound(ctx, "reported", (d) => seen.push(d.agentId));
    expect(seen[0]).toBe("comet");
    expect(seen).toHaveLength(6);
  });

  it("keeps the panel in roster order however the failures landed", async () => {
    const { ctx } = await harness({ transport: enterTransport() });
    breakWallet(ctx as never, "delta");
    const plan = await planRound(ctx, "order");
    expect(plan.decisions.map((d) => d.agentId)).toEqual(["atlas", "blaze", "comet", "delta", "ember", "flint"]);
  });

  it("stops the round only when every endpoint is dead", async () => {
    const { ctx } = await harness({ transport: enterTransport() });
    const dead = { ...ctx.chain, getBalances: async () => { throw new Error("The request took too long to respond. URL: https://rpc.example/key"); } };
    await expect(planRound({ ...ctx, chain: dead as never }, "alldead")).rejects.toThrow(ChainUnreachableError);
  });

  it("stops the round when the chain answers for nobody", async () => {
    // A read that succeeds but returns nothing is the same as no read at all.
    const { ctx } = await harness({ transport: enterTransport() });
    const empty = { ...ctx.chain, getBalances: async () => ({}) };
    for (const profile of ["atlas", "blaze", "comet", "delta", "ember", "flint"]) breakWallet(ctx as never, profile);
    await expect(planRound({ ...ctx, chain: empty as never }, "nobody")).rejects.toThrow(/no agent balance could be read/);
  });

  it("never enters an agent on a balance nobody read", async () => {
    const { ctx } = await harness({ transport: enterTransport() });
    breakWallet(ctx as never, "blaze");
    const plan = await planRound(ctx, "unverified");
    const blaze = plan.decisions.find((d) => d.agentId === "blaze")!;
    expect(blaze.balanceWei).toBe(0n);
    expect(blaze.decision.stake).toBe(0);
    expect(plan.snapshots.map((s) => s.profile.id)).not.toContain("blaze");
    expect(plan.entering.map((e) => e.agentId)).not.toContain("blaze");
  });
});

describe("every decision says who is sitting there and what it owes", () => {
  // The debt only rides along with the bank on, because with it off there is
  // no debt and the lineup must render exactly what it always rendered.
  afterEach(() => {
    delete process.env.SERVPIT_BANK_ENABLED;
  });

  // The face and the debt were on the object built at the top of the loop,
  // which only the unreachable path ever used. Every decision the player
  // actually sees comes back from the model layer or from the tapped out
  // list, and both of those were dropping them: the lineup drew six original
  // faces for six replacements and showed nobody owing anything.
  it("carries the seat's face and debt on a decision that entered", async () => {
    process.env.SERVPIT_BANK_ENABLED = "true";
    const { ctx } = await harness({ transport: enterTransport() });
    ctx.debts.clear("atlas", "atlas-2", "r-0");
    ctx.debts.addLoan("atlas", "atlas-2", 3_000_000_000_000n, 500);
    const plan = await planRound(ctx, "demo");
    const atlas = plan.decisions.find((d) => d.agentId === "atlas")!;
    expect(atlas.face).not.toBeNull();
    expect(atlas.debtWei).toBe(3_000_000_000_000n);
  });

  it("carries them on a tapped out agent, which is the one most likely to owe", async () => {
    process.env.SERVPIT_BANK_ENABLED = "true";
    const { ctx } = await harness({ balanceWei: 8_000_000_000_000n, transport: enterTransport() });
    ctx.debts.clear("blaze", "blaze-2", "r-0");
    const plan = await planRound(ctx, "demo");
    const blaze = plan.decisions.find((d) => d.agentId === "blaze")!;
    expect(blaze.face).not.toBeNull();
    expect(blaze.debtWei).toBe(0n);
  });

  it("leaves an original without a replacement face, which is what null means", async () => {
    const { ctx } = await harness({ transport: enterTransport() });
    const plan = await planRound(ctx, "demo");
    expect(plan.decisions.every((d) => d.face === null)).toBe(true);
  });

  it("says nothing about debt with the bank off, so the lineup is what it was", async () => {
    process.env.SERVPIT_BANK_ENABLED = "false";
    const { ctx } = await harness({ transport: enterTransport() });
    const plan = await planRound(ctx, "demo");
    expect(plan.decisions.every((d) => d.debtWei === undefined)).toBe(true);
  });
});
