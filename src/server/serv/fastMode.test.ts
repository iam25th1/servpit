// A fast run pauses the pit, plays real rounds, and leaves everything as it
// was found. The second half of this file is the real thing: a fake chain, a
// stub transport standing in for SERV, and the worker's own round function.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAUSE_FILE } from "@/config/arena";
import { pullSettingsFile } from "@/config/pulls";
import { SERV_SCHEDULED_FILE } from "@/config/serv";
import { DEFAULT_SERV } from "@/config/serv";
import { toChips, stakeWeiFrom } from "@/config/stake";
import { ArenaStore, arenaFile } from "@/server/arena/state";
import { playArenaRound } from "@/server/arena/worker";
import { BankrollCache } from "@/server/bankroll";
import { TransferLedger } from "@/server/ledger";
import { readPullSettings, writePullSettings } from "@/server/pulls/settings";
import { DebtStore } from "@/server/round/debt";
import { RolloverStore } from "@/server/round/rollover";
import { RoundStore } from "@/server/round/store";
import { SummaryStore, summaryFile } from "@/server/round/summaries";
import { WreckStore } from "@/server/round/wrecks";
import { CostMeter, ServClient, type ChatTransport } from "@/server/serv/client";
import { loadStores } from "@/server/stats/read";
import { WalletRegistry } from "@/server/wallets/registry";
import { FakeChain } from "@/server/wallets/fake";
import { openWallets } from "@/server/wallets/open";
import { fastMode } from "./fastMode";
import { reasonedSoFar } from "./reasonTo";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-fast-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const settled = () => ({ paused: false, phase: "resting" as string | null });

const base = () => ({
  dataDir: dir,
  need: 1,
  capMicroCents: 10_000_000,
  spentTodayMicroCents: 0,
  arenaState: settled,
  say: () => {},
  read: () => ({ reasoned: true, calls: 6, microCents: 2_000_000 }),
  onRound: () => {},
  sleep: async () => {},
});

describe("what a fast run touches", () => {
  it("pauses, raises the budget, turns the switch on, and puts all three back", async () => {
    const settingsFile = pullSettingsFile(dir);
    writePullSettings(settingsFile, { perIdentity: 3, windowHours: 6, dailyBudgetCents: 25, perHour: 6 });
    const during: Array<{ paused: boolean; scheduled: boolean; budget: number }> = [];

    const outcome = await fastMode({
      ...base(),
      // A cap above the day's budget, which is the case that needs a raise.
      capMicroCents: 50_000_000,
      play: async () => {
        during.push({
          paused: existsSync(join(dir, PAUSE_FILE)),
          scheduled: existsSync(join(dir, SERV_SCHEDULED_FILE)),
          budget: readPullSettings(settingsFile).dailyBudgetCents,
        });
        return "r-1";
      },
      backupTo: join(dir, "..", "settings.backup.json"),
    });

    // While it ran: paused, switched on, budget covering the cap.
    expect(during).toEqual([{ paused: true, scheduled: true, budget: 51 }]);
    // Afterwards: nothing left behind.
    expect(existsSync(join(dir, PAUSE_FILE))).toBe(false);
    expect(existsSync(join(dir, SERV_SCHEDULED_FILE))).toBe(false);
    expect(readPullSettings(settingsFile).dailyBudgetCents).toBe(25);
    expect(outcome.restored.every((r) => r.error === null)).toBe(true);
    expect(outcome.budget).toEqual({ was: 25, raisedTo: 51 });
    rmSync(join(dir, "..", "settings.backup.json"), { force: true });
  });

  it("leaves a pit the operator had paused paused, and still restores the rest", async () => {
    writeFileSync(join(dir, PAUSE_FILE), "paused by the operator\n");
    const outcome = await fastMode({ ...base(), play: async () => "r-1", arenaState: () => ({ paused: true, phase: "resting" }) });

    expect(existsSync(join(dir, PAUSE_FILE))).toBe(true);
    expect(outcome.paused).toBe(false);
    expect(existsSync(join(dir, SERV_SCHEDULED_FILE))).toBe(false);
  });

  it("leaves the switch on when it was already on", async () => {
    writeFileSync(join(dir, SERV_SCHEDULED_FILE), "on\n");
    await fastMode({ ...base(), play: async () => "r-1" });
    expect(existsSync(join(dir, SERV_SCHEDULED_FILE))).toBe(true);
  });

  it("waits for the round in flight, then plays", async () => {
    const phases = ["planning", "fight", "result", "resting"];
    let at = 0;
    const outcome = await fastMode({
      ...base(),
      arenaState: () => ({ paused: false, phase: phases[Math.min(at++, phases.length - 1)] ?? null }),
      play: async () => "r-1",
      pollMs: 1,
    });
    expect(at).toBeGreaterThan(3);
    expect(outcome.result.played).toBe(1);
    expect(outcome.waitTimedOut).toBe(false);
  });

  it("gives up rather than playing beside a round that will not settle", async () => {
    const play = vi.fn(async () => "r-1");
    let clock = 0;
    const outcome = await fastMode({
      ...base(),
      arenaState: () => ({ paused: false, phase: "fight" }),
      play,
      now: () => (clock += 10_000),
      pauseWaitMs: 20_000,
      pollMs: 1,
    });
    expect(outcome.waitTimedOut).toBe(true);
    expect(play).not.toHaveBeenCalled();
    expect(outcome.result.played).toBe(0);
    // And it still cleaned up the pause file it had written.
    expect(existsSync(join(dir, PAUSE_FILE))).toBe(false);
  });

  it("puts everything back when a round throws", async () => {
    const settingsFile = pullSettingsFile(dir);
    writePullSettings(settingsFile, { perIdentity: 3, windowHours: 6, dailyBudgetCents: 25, perHour: 6 });

    await expect(
      fastMode({
        ...base(),
        play: async () => {
          throw new Error("the chain went away");
        },
      }),
    ).rejects.toThrow("the chain went away");

    expect(existsSync(join(dir, PAUSE_FILE))).toBe(false);
    expect(existsSync(join(dir, SERV_SCHEDULED_FILE))).toBe(false);
    expect(readPullSettings(settingsFile).dailyBudgetCents).toBe(25);
  });

  it("leaves a budget that already covers the run alone, and backs nothing up", async () => {
    const settingsFile = pullSettingsFile(dir);
    writePullSettings(settingsFile, { perIdentity: 3, windowHours: 6, dailyBudgetCents: 500, perHour: 6 });
    const backup = join(dir, "..", `servpit-untouched-${process.pid}.json`);

    const outcome = await fastMode({ ...base(), play: async () => "r-1", backupTo: backup });

    expect(outcome.budget).toEqual({ was: 500, raisedTo: 500 });
    expect(readPullSettings(settingsFile).dailyBudgetCents).toBe(500);
    expect(existsSync(backup)).toBe(false);
    // Nothing to put back but the pause file.
    expect(outcome.restored.map((r) => r.name)).toEqual(["the scheduled reasoning switch", "the pause file"]);
  });

  it("backs the settings file up before changing it", async () => {
    const settingsFile = pullSettingsFile(dir);
    writePullSettings(settingsFile, { perIdentity: 3, windowHours: 6, dailyBudgetCents: 25, perHour: 6 });
    const backup = join(dir, "..", `servpit-fast-backup-${process.pid}.json`);

    await fastMode({ ...base(), capMicroCents: 50_000_000, play: async () => "r-1", backupTo: backup });

    expect(JSON.parse(readFileSync(backup, "utf8")).dailyBudgetCents).toBe(25);
    rmSync(backup, { force: true });
  });
});

/** Six agents that enter at the seat price, with the model's voice. */
const transport = (): ChatTransport =>
  ({
    create: vi.fn().mockImplementation(async (req: { messages: Array<{ content: string }> }) => {
      const content = req.messages[1].content.includes("wants to put up")
        ? JSON.stringify({ approve: false, amount: 0, rateBps: 0, reason: "Not this time, the book is thin." })
        : JSON.stringify({ enter: true, stake: toChips(stakeWeiFrom()), reason: "Odds look fine, I am in." });
      return {
        model: "claude-haiku-4.5",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1_200, completion_tokens: 60, total_tokens: 1_260 },
      };
    }),
  }) as unknown as ChatTransport;

describe("a fast run end to end, on the fake chain", () => {
  it("pauses, plays real rounds that reason, counts them, and restores every file", async () => {
    const network = "fake";
    const seat = stakeWeiFrom();
    const chain = new FakeChain({ initialBalanceWei: seat * 20n });
    const wallets = await openWallets(chain, new WalletRegistry(join(dir, `wallets-${network}.json`), network), { bank: true, operator: true });
    chain.fund(wallets.pot.address, seat * 50n);
    const roundStore = new RoundStore(join(dir, `rounds-${network}.json`), network);
    const summaries = new SummaryStore(summaryFile(dir, network), network);
    const settingsFile = pullSettingsFile(dir);
    writePullSettings(settingsFile, { perIdentity: 3, windowHours: 6, dailyBudgetCents: 25, perHour: 6 });

    const flow = {
      chain,
      wallets,
      ledger: new TransferLedger(join(dir, `ledger-${network}.json`), network),
      store: roundStore,
      summaries,
      bankroll: new BankrollCache({ ttlMs: 0, now: () => 0 }),
      meter: new CostMeter(DEFAULT_SERV.pricing),
      serv: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, transport()),
      rollover: new RolloverStore(join(dir, `rollover-${network}.json`), network),
      debts: new DebtStore(join(dir, `debts-${network}.json`), network),
      wreckStore: new WreckStore(join(dir, `wrecks-${network}.json`), network),
      settleLockFile: join(dir, `settle-${network}.lock`),
      servSwitchFile: join(dir, "serv-off"),
      servScheduledFile: join(dir, SERV_SCHEDULED_FILE),
      pullSettingsFile: settingsFile,
      entrants: 24,
    };
    const ctx = { env: { dataDir: dir }, chain, wallets, bankroll: flow.bankroll, flow } as unknown as Parameters<typeof playArenaRound>[0];
    const store = new ArenaStore(arenaFile(dir, network), network);
    const lines: string[] = [];

    const outcome = await fastMode({
      dataDir: dir,
      need: 2,
      capMicroCents: 50_000_000,
      spentTodayMicroCents: 0,
      arenaState: () => {
        const state = store.read();
        return { paused: state.paused === true, phase: state.round?.phase ?? null };
      },
      play: async () => {
        // The worker's own round, with the show off. Everything else is the
        // ordinary path: planRound, runRound, the settle lock, the stores.
        const played = await playArenaRound(ctx, store, Date.now(), null, { show: false });
        expect(played).toBe("played");
        return roundStore.all().at(-1)!.roundId;
      },
      read: (roundId) => {
        const row = roundStore.get(roundId);
        if (row === undefined) return null;
        return {
          reasoned: (row.agents ?? []).some((a) => a.source === "serv"),
          calls: row.servCalls ?? 0,
          microCents: row.servTokensIn !== undefined && typeof row.servMicroCents === "number" ? row.servMicroCents : 0,
        };
      },
      onRound: (row) => lines.push(`${row.roundId} ${row.reasoned ? "reasoned" : "instinct"} ${row.calls} calls`),
      say: () => {},
      sleep: async () => {},
    });

    // Two rounds, reasoned, settled and recorded.
    expect(outcome.result).toMatchObject({ played: 2, reasoned: 2, why: "target" });
    expect(outcome.result.calls).toBeGreaterThanOrEqual(12);
    expect(outcome.result.spentMicroCents).toBeGreaterThan(0);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.includes("reasoned"))).toBe(true);

    // In the round store, in the permanent summaries, and counted the way
    // npm run stats counts them.
    const stored = roundStore.all();
    expect(stored).toHaveLength(2);
    expect(stored.every((r) => r.agents.some((a) => a.source === "serv"))).toBe(true);
    expect(stored.every((r) => r.reconciled)).toBe(true);
    expect(summaries.all().map((s) => s.answers)).toEqual(["reasoned", "reasoned"]);
    expect(reasonedSoFar(loadStores(dir, network))).toBe(2);

    // And every file this run touched is back as it was.
    expect(existsSync(join(dir, PAUSE_FILE))).toBe(false);
    expect(existsSync(join(dir, SERV_SCHEDULED_FILE))).toBe(false);
    expect(readPullSettings(settingsFile).dailyBudgetCents).toBe(25);
    expect(outcome.restored.every((r) => r.error === null)).toBe(true);

    // The rounds went through with no show: a backing mark that lasts nothing,
    // so no window is ever open on a round that has already settled.
    const backing = store.read().last?.phases.find((p) => p.phase === "backing");
    expect(backing?.durationMs).toBe(0);
  }, 60_000);
});
