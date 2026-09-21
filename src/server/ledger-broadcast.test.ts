// A transfer that landed is never sent again.
//
// The hole this closes: the hash was a local value inside the wallet's send,
// so a receipt wait that timed out threw it away. The ledger then recorded
// the transfer as failed with no hash, and the next attempt asked the node
// for a fresh nonce and paid the same money a second time.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TransferLedger } from "./ledger";
import { FakeChain } from "./wallets/fake";
import type { BroadcastState, Wallet } from "./wallets/types";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const FUNDED = 1_000_000n;
const AMOUNT = 10_000n;

async function harness(options: { receiptWaitFails?: (txHash: string) => boolean } = {}) {
  dir = mkdtempSync(join(tmpdir(), "servpit-broadcast-"));
  const file = join(dir, "ledger.json");
  const chain = new FakeChain({ initialBalanceWei: FUNDED, receiptWaitFails: options.receiptWaitFails });
  const from = await chain.open("atlas");
  const to = await chain.open("pot");
  const ledger = new TransferLedger(file);
  const transfer = (l: TransferLedger = ledger, sender: Wallet = from) =>
    l.transferOnce({ key: "k-1", roundId: "r-1", agentId: "atlas", kind: "entry", from: sender, to: to.address, amountWei: AMOUNT, network: "fake" });
  return { chain, from, to, ledger, file, transfer };
}

describe("a receipt wait that times out after the transfer landed", () => {
  it("records the hash before waiting, so the retry has something to ask about", async () => {
    const { ledger, transfer, file } = await harness({ receiptWaitFails: () => true });
    await expect(transfer()).rejects.toThrow(/too long/);

    const record = ledger.get("k-1")!;
    expect(record.status).toBe("broadcast");
    expect(record.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    // On disk, not only in memory: the process can die inside that wait.
    const stored = JSON.parse(readFileSync(file, "utf8")).transfers["k-1"];
    expect(stored.status).toBe("broadcast");
    expect(stored.txHash).toBe(record.txHash);
  });

  it("settles the retry against the chain and moves the money exactly once", async () => {
    // The wait fails, the retry finds the transaction mined, and nothing is
    // sent a second time.
    let failWait = true;
    const { chain, from, to, ledger, transfer } = await harness({ receiptWaitFails: () => failWait });
    await expect(transfer()).rejects.toThrow(/too long/);
    const broadcastHash = ledger.get("k-1")!.txHash;
    const appliedAfterFirst = chain.applied;

    failWait = false;
    const settled = await transfer();

    expect(chain.applied).toBe(appliedAfterFirst);
    expect(settled.status).toBe("complete");
    expect(settled.txHash).toBe(broadcastHash);
    expect(chain.balanceOf(from.address)).toBe(FUNDED - AMOUNT);
    expect(chain.balanceOf(to.address)).toBe(FUNDED + AMOUNT);
  });

  it("survives a restart: a fresh ledger reads the hash off disk and still does not resend", async () => {
    let failWait = true;
    const { chain, from, to, file, transfer } = await harness({ receiptWaitFails: () => failWait });
    await expect(transfer()).rejects.toThrow(/too long/);
    const appliedAfterFirst = chain.applied;

    failWait = false;
    const reopened = new TransferLedger(file);
    const settled = await transfer(reopened, from);

    expect(chain.applied).toBe(appliedAfterFirst);
    expect(settled.status).toBe("complete");
    expect(chain.balanceOf(to.address)).toBe(FUNDED + AMOUNT);
  });

  it("does not resend while the transaction is still pending", async () => {
    const { chain, from, ledger, transfer } = await harness({ receiptWaitFails: () => true });
    await expect(transfer()).rejects.toThrow(/too long/);
    const applied = chain.applied;

    const pending: Wallet = { ...from, checkBroadcast: async (): Promise<BroadcastState> => ({ state: "pending" }) };
    // The wait still fails, so the retry fails too, and the point is that it
    // waited rather than replacing a transaction that can still mine.
    await expect(transfer(ledger, pending)).rejects.toThrow(/too long/);
    expect(chain.applied).toBe(applied);
    expect(ledger.get("k-1")!.status).toBe("broadcast");
  });

  it("refuses outright while the chain cannot say what became of it", async () => {
    const { chain, from, ledger, transfer } = await harness({ receiptWaitFails: () => true });
    await expect(transfer()).rejects.toThrow(/too long/);
    const applied = chain.applied;

    const unsure: Wallet = { ...from, checkBroadcast: async (): Promise<BroadcastState> => ({ state: "unknown" }) };
    await expect(transfer(ledger, unsure)).rejects.toThrow(/Refusing to send it again/);
    expect(chain.applied).toBe(applied);
  });

  it("sends again only once the chain confirms the transaction is gone", async () => {
    let failWait = true;
    const { chain, from, to, ledger, transfer } = await harness({ receiptWaitFails: () => failWait });
    await expect(transfer()).rejects.toThrow(/too long/);
    const applied = chain.applied;

    failWait = false;
    // The fake chain reports dropped for a hash it never saw; here the earlier
    // broadcast is explicitly declared gone.
    const dropped: Wallet = { ...from, checkBroadcast: async (): Promise<BroadcastState> => ({ state: "dropped" }) };
    const settled = await transfer(ledger, dropped);

    expect(chain.applied).toBe(applied + 1);
    expect(settled.status).toBe("complete");
    // Once, for the resend, because the first one was never charged: the fake
    // chain applied it, so the balance reflects both. What matters is that the
    // resend only happened after a confirmed drop.
    expect(chain.balanceOf(to.address)).toBe(FUNDED + AMOUNT * 2n);
  });

  it("marks a reverted transaction failed and does not send it again", async () => {
    const { chain, from, ledger, transfer } = await harness({ receiptWaitFails: () => true });
    await expect(transfer()).rejects.toThrow(/too long/);
    const applied = chain.applied;

    const reverted: Wallet = { ...from, checkBroadcast: async (): Promise<BroadcastState> => ({ state: "reverted", txHash: ledger.get("k-1")!.txHash! }) };
    await expect(transfer(ledger, reverted)).rejects.toThrow(/reverted on chain/);
    expect(chain.applied).toBe(applied);
    expect(ledger.get("k-1")!.status).toBe("failed");
  });

  it("still sends a transfer that never reached a node", async () => {
    // No hash means nothing was broadcast, so there is nothing to double pay.
    const { chain, to, ledger } = await harness();
    const broken = { ...(await chain.open("atlas")), send: async () => { throw new Error("connection refused"); } } as unknown as Wallet;
    await expect(
      ledger.transferOnce({ key: "k-2", roundId: "r-1", agentId: "atlas", kind: "entry", from: broken, to: to.address, amountWei: AMOUNT, network: "fake" }),
    ).rejects.toThrow(/connection refused/);
    expect(ledger.get("k-2")!.status).toBe("failed");
    expect(ledger.get("k-2")!.txHash).toBeUndefined();
  });
});
