import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { idempotencyKey } from "./idempotency";
import { TransferLedger } from "./ledger";
import { FakeChain } from "./wallets/fake";
import type { Call, Wallet } from "./wallets/types";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const setup = async () => {
  dir = mkdtempSync(join(tmpdir(), "servpit-ledger-"));
  const chain = new FakeChain({ initialBalanceWei: 1_000n });
  const agent = await chain.open("atlas");
  const pot = await chain.open("pot");
  const ledger = new TransferLedger(join(dir, "ledger.json"));
  return { chain, agent, pot, ledger };
};

describe("TransferLedger.transferOnce", () => {
  it("sends once, records hashes, and a retry with the same round and agent returns the same record without paying again", async () => {
    const { chain, agent, pot, ledger } = await setup();
    const key = idempotencyKey("round-1", "atlas", "entry");
    const first = await ledger.transferOnce({ key, roundId: "round-1", agentId: "atlas", kind: "entry", from: agent, to: pot.address, amountWei: 300n, network: "fake" });
    const second = await ledger.transferOnce({ key, roundId: "round-1", agentId: "atlas", kind: "entry", from: agent, to: pot.address, amountWei: 300n, network: "fake" });
    expect(first.status).toBe("complete");
    expect(first.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(second).toEqual(first);
    expect(chain.applied).toBe(1);
    expect(await agent.getBalance()).toBe(700n);
  });

  it("retries a transfer that crashed after sending, and the chain level key still prevents a double pay", async () => {
    const { chain, agent, pot, ledger } = await setup();
    const key = idempotencyKey("round-2", "atlas", "entry");
    let crashOnce = true;
    const flaky: Wallet = {
      ...agent,
      send: async (calls: readonly Call[], k: string) => {
        const receipt = await agent.send(calls, k);
        if (crashOnce) {
          crashOnce = false;
          throw new Error("network dropped after broadcast");
        }
        return receipt;
      },
    };
    await expect(ledger.transferOnce({ key, roundId: "round-2", agentId: "atlas", kind: "entry", from: flaky, to: pot.address, amountWei: 100n, network: "fake" })).rejects.toThrow(/dropped/);
    expect(ledger.get(key)?.status).toBe("failed");
    const retried = await ledger.transferOnce({ key, roundId: "round-2", agentId: "atlas", kind: "entry", from: flaky, to: pot.address, amountWei: 100n, network: "fake" });
    expect(retried.status).toBe("complete");
    expect(chain.applied).toBe(1);
    expect(await agent.getBalance()).toBe(900n);
  });

  it("refuses to reuse a key for a different amount or destination", async () => {
    const { agent, pot, ledger } = await setup();
    const key = idempotencyKey("round-3", "atlas", "entry");
    await ledger.transferOnce({ key, roundId: "round-3", agentId: "atlas", kind: "entry", from: agent, to: pot.address, amountWei: 50n, network: "fake" });
    await expect(ledger.transferOnce({ key, roundId: "round-3", agentId: "atlas", kind: "entry", from: agent, to: pot.address, amountWei: 51n, network: "fake" })).rejects.toThrow(/mismatch/);
  });

  it("persists records as strings of wei and survives a reload", async () => {
    const { agent, pot, ledger } = await setup();
    const key = idempotencyKey("round-4", "atlas", "entry");
    await ledger.transferOnce({ key, roundId: "round-4", agentId: "atlas", kind: "entry", from: agent, to: pot.address, amountWei: 10n, network: "fake" });
    const raw = readFileSync(join(dir, "ledger.json"), "utf8");
    expect(raw).toContain('"amountWei": "10"');
    const reloaded = new TransferLedger(join(dir, "ledger.json"));
    expect(reloaded.get(key)?.txHash).toBe(ledger.get(key)?.txHash);
    expect(reloaded.forRound("round-4")).toHaveLength(1);
  });

  it("rejects a zero or negative amount before touching the chain", async () => {
    const { chain, agent, pot, ledger } = await setup();
    const key = idempotencyKey("round-5", "atlas", "entry");
    await expect(ledger.transferOnce({ key, roundId: "round-5", agentId: "atlas", kind: "entry", from: agent, to: pot.address, amountWei: 0n, network: "fake" })).rejects.toThrow(RangeError);
    expect(chain.applied).toBe(0);
  });
});

describe("TransferLedger.correctFee", () => {
  it("writes the fee the chain reports over the one recorded at confirm time", async () => {
    const { chain, agent, pot, ledger } = await setup();
    const key = idempotencyKey("round-1", "atlas", "entry");
    await ledger.transferOnce({ key, roundId: "round-1", agentId: "atlas", kind: "entry", from: agent, to: pot.address, amountWei: 300n, network: "fake" });

    expect(ledger.correctFee(key, 132_025_268_374n)).toBe(true);
    expect(ledger.get(key)?.feeWei).toBe(132_025_268_374n);
    // And it survives a reload, because the point is that the store stops
    // holding a number the chain disagrees with.
    expect(new TransferLedger(join(dir, "ledger.json")).get(key)?.feeWei).toBe(132_025_268_374n);
    expect(chain.kind).toBe("fake");
  });

  it("changes nothing else about the record", async () => {
    const { agent, pot, ledger } = await setup();
    const key = idempotencyKey("round-1", "atlas", "entry");
    const before = await ledger.transferOnce({ key, roundId: "round-1", agentId: "atlas", kind: "entry", from: agent, to: pot.address, amountWei: 300n, network: "fake" });
    ledger.correctFee(key, 99n);
    const after = ledger.get(key)!;
    expect({ ...after, feeWei: before.feeWei, updatedAt: before.updatedAt }).toEqual(before);
  });

  it("refuses a key it does not hold, and a record that is not complete", async () => {
    const { ledger } = await setup();
    expect(ledger.correctFee("nothing-like-this", 1n)).toBe(false);
  });

  it("says nothing changed when the figures already agree", async () => {
    const { agent, pot, ledger } = await setup();
    const key = idempotencyKey("round-1", "atlas", "entry");
    const record = await ledger.transferOnce({ key, roundId: "round-1", agentId: "atlas", kind: "entry", from: agent, to: pot.address, amountWei: 300n, network: "fake" });
    expect(ledger.correctFee(key, record.feeWei ?? 0n)).toBe(false);
  });
});
