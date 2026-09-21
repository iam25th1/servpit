import { describe, expect, it } from "vitest";
import { assertBankShareIsPayable, bankShareOnHouseWin, DEFAULT_BANK_SHARE_ON_HOUSE_WIN, economyConfig } from "./economy";

/** ProcessEnv insists on NODE_ENV, and these cases are about one variable. */
const env = (vars: Record<string, string> = {}): NodeJS.ProcessEnv => ({ NODE_ENV: "test", ...vars });

describe("bank share", () => {
  it("defaults to zero, so every unclaimed prize rolls over and nothing is owed", () => {
    expect(DEFAULT_BANK_SHARE_ON_HOUSE_WIN).toBe(0);
    expect(bankShareOnHouseWin(env())).toBe(0);
  });

  it("reads the env override and refuses one outside zero to one", () => {
    expect(bankShareOnHouseWin(env({ SERVPIT_BANK_SHARE_ON_HOUSE_WIN: "0.25" }))).toBe(0.25);
    expect(() => bankShareOnHouseWin(env({ SERVPIT_BANK_SHARE_ON_HOUSE_WIN: "1.5" }))).toThrow(/between 0 and 1/);
    expect(() => bankShareOnHouseWin(env({ SERVPIT_BANK_SHARE_ON_HOUSE_WIN: "nope" }))).toThrow(/between 0 and 1/);
  });

  it("refuses to start when a share is owed and there is no bank wallet to pay it", () => {
    expect(() => assertBankShareIsPayable(false, env({ SERVPIT_BANK_SHARE_ON_HOUSE_WIN: "0.5" }))).toThrow(/no bank wallet/);
  });

  it("starts at zero with no bank wallet, and at any share once one exists", () => {
    expect(() => assertBankShareIsPayable(false, env())).not.toThrow();
    expect(() => assertBankShareIsPayable(false, env({ SERVPIT_BANK_SHARE_ON_HOUSE_WIN: "0" }))).not.toThrow();
    expect(() => assertBankShareIsPayable(true, env({ SERVPIT_BANK_SHARE_ON_HOUSE_WIN: "0.5" }))).not.toThrow();
  });
});

describe("credit terms", () => {
  it("scales every bound with the stake, so a stake change does not leave a stale number behind", () => {
    const small = economyConfig(10n);
    const large = economyConfig(1_000n);
    expect(small.minLoanWei).toBe(10n);
    expect(small.maxPrincipalWei).toBe(50n);
    expect(small.debtCeilingWei).toBe(60n);
    expect(large.maxPrincipalWei).toBe(5_000n);
    expect(large.debtCeilingWei).toBe(6_000n);
    expect(large.stakeWei).toBe(1_000n);
  });

  it("keeps the ceiling within reach of the principal cap, or it is dead config", () => {
    // Set it far above and an agent always runs out of balance first and is
    // wrecked for being broke. The simulator measured zero ceiling wrecks in
    // two thousand rounds when it sat three stakes clear.
    const c = economyConfig(10n);
    expect(c.debtCeilingWei).toBeGreaterThan(c.maxPrincipalWei);
    expect(c.debtCeilingWei - c.maxPrincipalWei).toBeLessThanOrEqual(2n * c.stakeWei);
  });

  it("leaves a replacement agent clean by default", () => {
    expect(economyConfig(10n).replacementDebtWei).toBe(0n);
  });

  it("takes overrides, which is what the simulator sweeps", () => {
    expect(economyConfig(10n, { interestBps: 0 }).interestBps).toBe(0);
  });

  it("refuses a stake that is not a positive bigint", () => {
    expect(() => economyConfig(0n)).toThrow(/positive bigint/);
    expect(() => economyConfig(10 as unknown as bigint)).toThrow(/positive bigint/);
  });
});
