import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TransferLedger } from "../ledger";
import { WalletRegistry } from "../wallets/registry";
import { DebtStore } from "../round/debt";
import { PlanStore } from "../round/planStore";
import { RolloverStore } from "../round/rollover";
import { RoundStore } from "../round/store";
import { WreckStore } from "../round/wrecks";
import { StoreNetworkMismatch } from "./file";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const path = (name: string): string => {
  dir ??= mkdtempSync(join(tmpdir(), "servpit-separation-"));
  return join(dir, name);
};

const wreck = (walletId: string) => ({
  roundId: "r-1",
  walletId,
  identityId: `${walletId}-1`,
  name: "Flint",
  face: null,
  trigger: "broke and denied credit" as const,
  balanceAtDeathWei: "0",
  debtAtDeathWei: "0",
  principalAtDeathWei: "0",
  interestAtDeathWei: "0",
  seizedWei: "0",
  writtenOffWei: "0",
  peakBalanceWei: "0",
  borrowedWei: "0",
  loanCount: 0,
  recentStakeMultiples: [1],
  roundsSurvived: 1,
  wins: 0,
  at: "2026-09-21T00:00:00.000Z",
});

describe("a store belongs to one chain", () => {
  // The file names carry the network and always have. This is the check that
  // does not depend on a name: a graveyard full of fake chain deaths must not
  // be readable as real ones because a file was copied or renamed.
  it("stamps what it writes", () => {
    const file = path("wrecks.json");
    new WreckStore(file, "fake").save(wreck("flint"));
    expect(JSON.parse(readFileSync(file, "utf8")).network).toBe("fake");
  });

  it("refuses to read another chain's graveyard", () => {
    const file = path("wrecks.json");
    const fake = new WreckStore(file, "fake");
    fake.save(wreck("flint"));
    fake.save(wreck("ember"));
    expect(fake.all()).toHaveLength(2);
    expect(() => new WreckStore(file, "base-sepolia")).toThrow(StoreNetworkMismatch);
  });

  it("refuses to read another chain's debts, transfers, rounds, plans, rollover or wallets", () => {
    const debts = path("debts.json");
    new DebtStore(debts, "fake").addLoan("atlas", "atlas-1", 10n, 500);
    expect(() => new DebtStore(debts, "base-sepolia")).toThrow(StoreNetworkMismatch);

    const ledger = path("ledger.json");
    new TransferLedger(ledger, "fake");
    const rollover = path("rollover.json");
    new RolloverStore(rollover, "fake").record("r-1", 0n, 10n);
    expect(() => new RolloverStore(rollover, "base-sepolia")).toThrow(StoreNetworkMismatch);

    const rounds = path("rounds.json");
    new RoundStore(rounds, "fake").save({
      roundId: "r-1",
      seed: "s",
      createdAt: "2026-09-21T00:00:00.000Z",
      network: "fake",
      entrants: 24,
      winner: "bot-01",
      potWei: "0",
      rakeWei: "0",
      agents: [],
      reconciled: true,
      servCalls: 0,
      servMicroCents: 0,
    });
    expect(() => new RoundStore(rounds, "base-sepolia")).toThrow(StoreNetworkMismatch);

    const wallets = path("wallets.json");
    new WalletRegistry(wallets, "fake").set("atlas", { address: `0x${"a".repeat(40)}`, network: "fake" });
    expect(() => new WalletRegistry(wallets, "base-sepolia")).toThrow(StoreNetworkMismatch);

    const plans = path("plans.json");
    new PlanStore(plans, {}, "fake");
  });

  it("adopts a file written before the stamp, so no existing data is lost", () => {
    const file = path("wrecks.json");
    new WreckStore(file, "fake").save(wreck("flint"));
    // What an older build left behind: the same body without a network.
    const body = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    delete body.network;
    const legacy = path("legacy.json");
    new WreckStore(legacy, "fake");
    rmSync(legacy, { force: true });
    writeFileSync(legacy, JSON.stringify(body));

    const adopted = new WreckStore(legacy, "base-sepolia");
    expect(adopted.all()).toHaveLength(1);
    adopted.save(wreck("ember"));
    expect(JSON.parse(readFileSync(legacy, "utf8")).network).toBe("base-sepolia");
  });
});
