// What a paused pit says about itself: on /api/status, on /api/health, in
// the view the site reads, and to somebody pulling the lever.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stakeWeiFrom } from "@/config/stake";
import { DEFAULT_PULL_SETTINGS } from "../pulls/settings";
import { PullStore } from "../pulls/log";
import { requestPull } from "../pulls/service";
import { fundingCheck, type FundingContext } from "./funding";
import { health, pitStatus } from "./health";
import { ArenaStore, arenaFile, type ArenaFunds, type ArenaState } from "./state";
import { arenaView, phaseEvent } from "./view";

const NOW = Date.parse("2026-11-09T18:30:00.000Z");
const INTERVAL = 180_000;

/** What the worker writes when it finds the bank and the operator empty. */
async function brokeFunds(): Promise<ArenaFunds> {
  const balances: Record<string, bigint> = { pot: stakeWeiFrom() * 160n, bank: stakeWeiFrom() / 10n, operator: 0n };
  const ctx = {
    chain: { gasReserveWei: stakeWeiFrom() * 2n },
    wallets: { pot: { id: "pot" }, bank: { id: "bank" }, operator: { id: "operator" } },
    bankroll: { get: async (w: { id: string }) => balances[w.id] },
    flow: { rollover: { carriedWei: 0n } },
  } as unknown as FundingContext;
  const report = await fundingCheck(ctx, NOW);
  return { checkedAt: report.checkedAt, ok: report.ok, pot: report.pot, bank: report.bank, operator: report.operator };
}

async function held(): Promise<ArenaState> {
  return {
    round: null,
    last: null,
    paused: false,
    nextRoundAt: null,
    hold: { kind: "funds", since: "2026-11-09T18:00:00.000Z", reason: "The pit is paused because the bank and the operator are out of funds. It starts again on its own once they are topped up.", nextCheckAt: "2026-11-09T18:40:00.000Z" },
    funds: await brokeFunds(),
    updatedAt: "2026-11-09T18:30:00.000Z",
  };
}

describe("the status route's answer", () => {
  it("says paused, what for, what each wallet holds, and what to send to resume", async () => {
    const status = pitStatus(await held(), NOW - 30_000, INTERVAL, "base-sepolia", NOW);
    expect(status).toMatchObject({ ok: true, worker: "alive", pit: "paused", pausedFor: "funds", nextCheckAt: "2026-11-09T18:40:00.000Z" });
    expect(status.reason).toMatch(/out of funds/);
    // With the defaults a chip is 0.000001 ETH: the bank holds one and needs
    // fifty, the operator holds none and needs a hundred and twenty.
    expect(status.funds?.bank).toEqual({ chips: 1, eth: "0.000001", neededChips: 50, neededEth: "0.00005", toResumeChips: 49, toResumeEth: "0.000049", ok: false });
    expect(status.funds?.operator).toEqual({ chips: 0, eth: "0", neededChips: 120, neededEth: "0.00012", toResumeChips: 120, toResumeEth: "0.00012", ok: false });
    expect(status.funds?.pot.ok).toBe(true);
  });

  it("names no wallet: balances only, no address or hash", async () => {
    const body = JSON.stringify(pitStatus(await held(), NOW, INTERVAL, "base-sepolia", NOW));
    expect(body).not.toMatch(/0x[0-9a-fA-F]{6}/);
  });

  it("reads null funds before the worker has looked", () => {
    const status = pitStatus({ round: null, last: null, paused: false, nextRoundAt: null, updatedAt: "" }, null, INTERVAL, "fake", NOW);
    expect(status.funds).toBeNull();
    expect(status.pausedFor).toBeNull();
  });
});

describe("the health route while the pit holds", () => {
  it("still answers ok, so a pit waiting for money is not restarted as a dead one", async () => {
    const answer = health(await held(), NOW - 30_000, INTERVAL, "base-sepolia", NOW);
    expect(answer.ok).toBe(true);
    expect(answer.pit).toBe("paused");
    expect(answer.pausedFor).toBe("funds");
    // Still no money on the health route.
    expect(JSON.stringify(answer)).not.toMatch(/chips|wei|balance|eth"/i);
  });

  it("tells the operator's own pause apart from a hold", () => {
    const answer = health({ round: null, last: null, paused: true, nextRoundAt: null, updatedAt: "" }, NOW, INTERVAL, "fake", NOW);
    expect(answer.pausedFor).toBe("operator");
  });
});

describe("GET /api/status", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "servpit-status-route-"));
    vi.stubEnv("WALLET_BACKEND", "fake");
    vi.stubEnv("SERVPIT_DATA_DIR", dir);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers from the arena state the worker wrote, 200 while paused", async () => {
    const state = await held();
    new ArenaStore(arenaFile(dir, "fake"), "fake").write(state);
    const { GET } = await import("@/app/api/status/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { pit: string; pausedFor: string; funds: { bank: { toResumeEth: string } } };
    expect(body.pit).toBe("paused");
    expect(body.pausedFor).toBe("funds");
    expect(body.funds.bank.toResumeEth).toBe("0.000049");
  });
});

describe("what the site is sent", () => {
  it("carries the hold in the view and in every phase event, without the balances", async () => {
    const state = await held();
    const view = arenaView(state, { network: "fake", kind: "fake" });
    expect(view.pit.hold).toEqual({ kind: "funds", since: state.hold!.since, reason: state.hold!.reason });
    expect(JSON.stringify(view)).not.toMatch(/neededWei|shortWei/);
    expect(phaseEvent(view).hold).toBe("funds");
    expect(phaseEvent(arenaView({ ...state, hold: null }, { network: "fake", kind: "fake" })).hold).toBeNull();
  });
});

describe("pulling the lever on a held pit", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is refused with the reason, and queues nothing", async () => {
    dir = mkdtempSync(join(tmpdir(), "servpit-held-pull-"));
    const store = new PullStore(join(dir, "pulls-fake.ndjson"), "fake");
    const deps = { store, arenaMode: true, settings: DEFAULT_PULL_SETTINGS, budget: { spentMicroCents: 0, budgetMicroCents: 1, withinBudget: true }, reasoningOn: true };
    const answer = requestPull(await held(), { handle: "ash", token: "11111111-1111-4111-8111-111111111111" }, deps);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.status).toBe(409);
    expect(answer.message).toMatch(/paused: it is out of funds/);
    expect(store.pending()).toBeNull();
  });
});
