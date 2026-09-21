import { describe, expect, it } from "vitest";
import { assertBankShareIsPayable, bankShareOnHouseWin, DEFAULT_BANK_SHARE_ON_HOUSE_WIN } from "./economy";

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
