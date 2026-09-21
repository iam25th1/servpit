import { describe, expect, it } from "vitest";
import { CHIPS_PER_FUNDED_WALLET, DEFAULT_STAKE_FRACTION, stakeWeiFrom, toChips, weiPerChip } from "./stake";

const env = (v: Record<string, string> = {}): NodeJS.ProcessEnv => v as NodeJS.ProcessEnv;
const FUNDED = 100_000_000_000_000n; // 0.0001 ETH

describe("the stake", () => {
  it("is a tenth of a funded wallet by default", () => {
    // It was 100 wei against 100 trillion, one part in a trillion, so no
    // agent was ever constrained and its reasoning had nothing to weigh.
    expect(stakeWeiFrom(env())).toBe(FUNDED / 10n);
    expect(DEFAULT_STAKE_FRACTION).toBe(0.1);
  });

  it("follows the funding target, so the two cannot drift apart", () => {
    expect(stakeWeiFrom(env({ SERVPIT_FUND_TARGET_ETH: "0.001" }))).toBe(1_000_000_000_000_000n / 10n);
  });

  it("is settable as a fraction", () => {
    expect(stakeWeiFrom(env({ SERVPIT_STAKE_FRACTION: "0.25" }))).toBe(FUNDED / 4n);
    expect(stakeWeiFrom(env({ SERVPIT_STAKE_FRACTION: "1" }))).toBe(FUNDED);
  });

  it("refuses a fraction that is not a share", () => {
    expect(() => stakeWeiFrom(env({ SERVPIT_STAKE_FRACTION: "0" }))).toThrow(RangeError);
    expect(() => stakeWeiFrom(env({ SERVPIT_STAKE_FRACTION: "1.5" }))).toThrow(RangeError);
    expect(() => stakeWeiFrom(env({ SERVPIT_STAKE_FRACTION: "-0.2" }))).toThrow(RangeError);
    expect(() => stakeWeiFrom(env({ SERVPIT_STAKE_FRACTION: "lots" }))).toThrow(RangeError);
  });

  it("lets an agent play a handful of rounds, not one and not a trillion", () => {
    // The number that makes the decision mean something.
    const rounds = Number(FUNDED / stakeWeiFrom(env()));
    expect(rounds).toBe(10);
  });
});

describe("chips", () => {
  it("makes a funded wallet a round number a person can hold in their head", () => {
    expect(toChips(FUNDED, env())).toBe(CHIPS_PER_FUNDED_WALLET);
    expect(weiPerChip(env())).toBe(FUNDED / BigInt(CHIPS_PER_FUNDED_WALLET));
  });

  it("makes one seat ten chips at the default fraction", () => {
    expect(toChips(stakeWeiFrom(env()), env())).toBe(10);
  });

  it("rounds down, because a balance shown as more than it is invites an entry that will not clear", () => {
    const per = weiPerChip(env());
    expect(toChips(per * 3n + per / 2n, env())).toBe(3);
    expect(toChips(per - 1n, env())).toBe(0);
  });

  it("is zero for an empty wallet rather than a fraction", () => {
    expect(toChips(0n, env())).toBe(0);
  });

  it("scales with the funding target", () => {
    const e = env({ SERVPIT_FUND_TARGET_ETH: "0.001" });
    expect(toChips(1_000_000_000_000_000n, e)).toBe(CHIPS_PER_FUNDED_WALLET);
  });
});
