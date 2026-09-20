import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BankrollCache } from "./bankroll";
import { TransferLedger } from "./ledger";
import { collectEntry, payWinner } from "./transfers";
import { FakeChain } from "./wallets/fake";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("entry and payout transfers", () => {
  it("moves stake from agent to pot, then prize from pot to winner, invalidating cached bankrolls and surfacing hashes", async () => {
    dir = mkdtempSync(join(tmpdir(), "servpit-transfers-"));
    const chain = new FakeChain({ initialBalanceWei: 1_000n });
    const agent = await chain.open("atlas");
    const pot = await chain.open("pot");
    const ledger = new TransferLedger(join(dir, "ledger.json"));
    const bankroll = new BankrollCache({ ttlMs: 60_000, now: () => 0 });
    expect(await bankroll.get(agent)).toBe(1_000n);

    const entry = await collectEntry({ ledger, bankroll, network: chain.network, chainKind: chain.kind }, "round-9", "atlas", agent, pot, 250n);
    expect(entry.kind).toBe("entry");
    expect(entry.amountWei).toBe(250n);
    expect(entry.txHash).toMatch(/^0x/);
    expect(entry.link).toBeNull();
    expect(await bankroll.get(agent)).toBe(750n);
    expect(await bankroll.get(pot)).toBe(1_250n);

    const payout = await payWinner({ ledger, bankroll, network: chain.network, chainKind: chain.kind }, "round-9", "atlas", pot, agent, 900n);
    expect(payout.kind).toBe("payout");
    expect(await bankroll.get(agent)).toBe(1_650n);
    expect(await bankroll.get(pot)).toBe(350n);
    expect(chain.applied).toBe(2);
  });

  it("builds Basescan links on the cdp backend", async () => {
    dir = mkdtempSync(join(tmpdir(), "servpit-transfers-"));
    const chain = new FakeChain({ initialBalanceWei: 1_000n });
    const agent = await chain.open("atlas");
    const pot = await chain.open("pot");
    const ledger = new TransferLedger(join(dir, "ledger.json"));
    const bankroll = new BankrollCache({ ttlMs: 0, now: () => 0 });
    const entry = await collectEntry({ ledger, bankroll, network: "base-sepolia", chainKind: "cdp" }, "round-10", "atlas", agent, pot, 1n);
    expect(entry.link).toBe(`https://sepolia.basescan.org/tx/${entry.txHash}`);
  });
});
