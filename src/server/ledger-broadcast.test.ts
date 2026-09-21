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

async function harness(options: { receiptWaitFails?: (txHash: string) => boolean; stallsBroadcast?: (txHash: string) => boolean; hidesBroadcast?: (txHash: string) => boolean } = {}) {
  dir = mkdtempSync(join(tmpdir(), "servpit-broadcast-"));
  const file = join(dir, "ledger.json");
  const chain = new FakeChain({ initialBalanceWei: FUNDED, ...options });
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

  it("refuses outright when the chain cannot say and no nonce was recorded", async () => {
    const { chain, from, ledger, transfer } = await harness({ receiptWaitFails: () => true });
    // A wallet whose nonce could not be read: the record has a hash and
    // nothing to resend under, which is where refusing is the only answer.
    const nonceless: Wallet = { ...from, nextNonce: async () => Promise.reject(new Error("rpc down")) };
    await expect(transfer(ledger, nonceless)).rejects.toThrow(/too long/);
    expect(ledger.get("k-1")!.nonce).toBeUndefined();
    const applied = chain.applied;

    const unsure: Wallet = { ...nonceless, checkBroadcast: async (): Promise<BroadcastState> => ({ state: "unknown" }) };
    await expect(transfer(ledger, unsure)).rejects.toThrow(/Refusing to send it again/);
    expect(chain.applied).toBe(applied);
  });

  it("sends again under the same nonce once the chain confirms the transaction is gone", async () => {
    // Stalled once, so the fake chain agrees with the stub: nothing moved and
    // the nonce it went out under is still free. The resend is allowed to
    // land, which is the half of it being tested.
    let stalled = false;
    const { chain, from, to, ledger, transfer } = await harness({
      stallsBroadcast: () => {
        if (stalled) return false;
        stalled = true;
        return true;
      },
    });
    await expect(transfer()).rejects.toThrow(/too long/);
    const applied = chain.applied;
    const nonce = ledger.get("k-1")!.nonce;
    expect(nonce).toBe(0);

    const dropped: Wallet = { ...from, checkBroadcast: async (): Promise<BroadcastState> => ({ state: "dropped" }) };
    const settled = await transfer(ledger, dropped);

    expect(chain.applied).toBe(applied + 1);
    expect(settled.status).toBe("complete");
    expect(ledger.get("k-1")!.nonce).toBe(nonce);
    expect(chain.balanceOf(to.address)).toBe(FUNDED + AMOUNT);
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

  // What the nonce is for. A transfer the chain will not account for has two
  // possible histories and no way to tell them apart from here: it landed and
  // the node has lost sight of it, or it never landed at all. Sending again
  // under the nonce it went out under is safe in both, because one
  // transaction per nonce can ever mine.
  describe("a transfer the chain will not account for", () => {
    it("records the nonce it went out under, with every hash it has been sent as", async () => {
      const { ledger, transfer, file } = await harness({ receiptWaitFails: () => true });
      await expect(transfer()).rejects.toThrow(/too long/);
      const record = ledger.get("k-1")!;
      expect(record.nonce).toBe(0);
      expect(record.hashes).toEqual([record.txHash]);
      const stored = JSON.parse(readFileSync(file, "utf8")).transfers["k-1"];
      expect(stored.nonce).toBe(0);
    });

    it("lands the resend when the original never did, and moves the money once", async () => {
      let stalled = false;
      const { chain, to, ledger, transfer } = await harness({
        stallsBroadcast: () => {
          if (stalled) return false;
          stalled = true;
          return true;
        },
      });
      await expect(transfer()).rejects.toThrow(/too long/);
      expect(chain.applied).toBe(0);
      const first = ledger.get("k-1")!;

      const settled = await transfer();

      expect(settled.status).toBe("complete");
      expect(settled.nonce).toBe(first.nonce);
      expect(settled.hashes).toHaveLength(2);
      expect(settled.txHash).not.toBe(first.txHash);
      // Once. Two hashes, one transaction, one payment.
      expect(chain.applied).toBe(1);
      expect(chain.balanceOf(to.address)).toBe(FUNDED + AMOUNT);
    });

    it("fails the resend harmlessly when the original had already landed", async () => {
      // The money moved and the chain will not admit the transaction exists.
      // The resend goes out under the same nonce and is refused by the chain,
      // which is the whole safety property: nothing is paid twice.
      const { chain, to, ledger, transfer } = await harness({ hidesBroadcast: () => true, receiptWaitFails: () => true });
      await expect(transfer()).rejects.toThrow(/too long/);
      expect(chain.applied).toBe(1);
      const applied = chain.applied;

      await expect(transfer()).rejects.toThrow(/nonce too low/);

      expect(chain.applied).toBe(applied);
      expect(chain.balanceOf(to.address)).toBe(FUNDED + AMOUNT);
      // Still broadcast, not failed: the money did move, and saying otherwise
      // would invite somebody to send it again.
      expect(ledger.get("k-1")!.status).toBe("broadcast");
    });

    it("keeps the same nonce across several attempts, never taking a fresh one", async () => {
      const { ledger, transfer } = await harness({ stallsBroadcast: () => true });
      await expect(transfer()).rejects.toThrow(/too long/);
      const nonce = ledger.get("k-1")!.nonce;
      await expect(transfer()).rejects.toThrow(/too long/);
      await expect(transfer()).rejects.toThrow(/too long/);
      const record = ledger.get("k-1")!;
      expect(record.nonce).toBe(nonce);
      expect(record.hashes).toHaveLength(3);
    });
  });
});
