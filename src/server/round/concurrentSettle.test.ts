// Two settles at once, which is two lever pulls in two tabs.
//
// Every store here is read, decided on and written back, so two settles
// running together write the second one's decision from the first one's
// reading. The transfers are safe on their own, because each has an
// idempotency key and two rounds have two different keys, and that is exactly
// why the stores are not: both writes are legitimate and the later one
// silently replaces what the earlier one recorded.

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
import { DebtStore, totalOwed } from "./debt";
import { planRound, runRound } from "./flow";
import { RolloverStore } from "./rollover";
import { resetSettleQueue } from "./settleLock";
import { RoundStore } from "./store";
import { WreckStore } from "./wrecks";

let dir: string;

beforeEach(() => {
  process.env.SERVPIT_BANK_ENABLED = "true";
});

afterEach(() => {
  delete process.env.SERVPIT_BANK_ENABLED;
  resetSettleQueue();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Enters at the seat price, and borrows when it is short. */
const transport = (stakeChips: number): ChatTransport =>
  ({
    create: vi.fn().mockImplementation(async (req: { messages: Array<{ content: string }> }) => {
      const content = req.messages[1].content.includes("wants to put up")
        ? JSON.stringify({ approve: true, amount: 2, rateBps: 500, reason: "Clean slate, so I will carry you." })
        : JSON.stringify({ enter: true, stake: stakeChips, reason: "Feeling good, going big." });
      return { model: "claude-haiku-4.5", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 400, completion_tokens: 30, total_tokens: 430 } };
    }),
  }) as unknown as ChatTransport;

async function harness() {
  const seat = stakeWeiFrom();
  dir = mkdtempSync(join(tmpdir(), "servpit-concurrent-"));
  const chain = new FakeChain({ initialBalanceWei: seat * 4n });
  const wallets = await openWallets(chain, new WalletRegistry(join(dir, "wallets.json"), "fake"), { bank: true, operator: true });
  chain.fund(wallets.bank!.address, seat * 50n);
  chain.fund(wallets.operator!.address, seat * 50n);
  const debts = new DebtStore(join(dir, "debts.json"), "fake");
  const wreckStore = new WreckStore(join(dir, "wrecks.json"), "fake");
  const rollover = new RolloverStore(join(dir, "rollover.json"), "fake");
  const store = new RoundStore(join(dir, "rounds.json"), "fake");
  const ctx = {
    chain,
    wallets,
    ledger: new TransferLedger(join(dir, "ledger.json"), "fake"),
    store,
    bankroll: new BankrollCache({ ttlMs: 0, now: () => 0 }),
    meter: new CostMeter(DEFAULT_SERV.pricing),
    rollover,
    debts,
    wreckStore,
    serv: new ServClient({ ...DEFAULT_SERV, backoffMs: 0 }, transport(toChips(seat))),
    settleLockFile: join(dir, "settle.lock"),
    entrants: 24,
  };
  return { chain, wallets, ctx, debts, wreckStore, rollover, store, seat };
}

describe("two settles at once", () => {
  it("runs them one after the other, and both land", async () => {
    const { ctx, store } = await harness();
    const first = await planRound(ctx, "race-one");
    const second = await planRound(ctx, "race-two");

    const [one, two] = await Promise.all([runRound(ctx, first), runRound(ctx, second)]);

    expect(one.reconciliation.ok).toBe(true);
    expect(two.reconciliation.ok).toBe(true);
    // Both are in the history. One settle writing over the other's record is
    // what this is here to catch: the file holds a list, and a lost update
    // drops a whole round out of it.
    expect(store.get(first.roundId)?.roundId).toBe(first.roundId);
    expect(store.get(second.roundId)?.roundId).toBe(second.roundId);
  });

  it("does not lose one settle's rollover to the other", async () => {
    const { ctx, rollover } = await harness();
    const first = await planRound(ctx, "roll-one");
    const second = await planRound(ctx, "roll-two");

    const [one, two] = await Promise.all([runRound(ctx, first), runRound(ctx, second)]);

    // Whichever went second inherited what the first left, and the file holds
    // what the second one left. Interleaved, the second would have read zero
    // and the pot would owe chips nobody carried.
    const last = two.rolloverInWei === one.prize.nextRolloverWei ? two : one;
    const other = last === two ? one : two;
    expect(last.rolloverInWei).toBe(other.prize.nextRolloverWei);
    expect(rollover.carriedWei).toBe(last.prize.nextRolloverWei);
  });

  it("does not lose one settle's debts or wrecks to the other", async () => {
    const { ctx, debts, wreckStore } = await harness();
    const first = await planRound(ctx, "debt-one");
    const second = await planRound(ctx, "debt-two");

    const [one, two] = await Promise.all([runRound(ctx, first), runRound(ctx, second)]);

    // Every loan either round paid out is still owed, or was repaid or
    // written off by a wreck. Nothing vanished because the other settle
    // wrote over the record of it.
    const lent = [...one.loans, ...two.loans].reduce((sum, l) => sum + l.amountWei, 0n);
    const owed = debts.all().reduce((sum, d) => sum + totalOwed(d), 0n);
    const cleared = [...one.wrecks, ...two.wrecks].reduce((sum, w) => sum + BigInt(w.seizedWei) + BigInt(w.writtenOffWei), 0n);
    const repaid = [one.repayment, two.repayment].reduce((sum, r) => sum + (r ? r.principalWei : 0n), 0n);
    const interest = [...one.interest, ...two.interest].reduce((sum, i) => sum + i.chargedWei, 0n);
    expect(owed + cleared + repaid).toBe(lent + interest);

    for (const w of [...one.wrecks, ...two.wrecks]) {
      expect(wreckStore.all().some((r) => r.roundId === w.roundId && r.walletId === w.walletId)).toBe(true);
    }
  });
});
