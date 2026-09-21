import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanNotQuoted, PlanStore } from "./planStore";
import type { RoundPlan } from "./flow";

const dirs: string[] = [];
const file = (): string => {
  const d = mkdtempSync(join(tmpdir(), "servpit-plans-"));
  dirs.push(d);
  return join(d, "plans.json");
};
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const plan = (roundId: string, stakeWei = 10_000_000_000_000n): RoundPlan => ({
  roundId,
  seed: "s",
  stakeWei,
  decisions: [{ agentId: "atlas", name: "Atlas", strategy: "cautious", address: "0x" + "1".repeat(40), balanceWei: 99n, decision: { enter: true, stake: 10, reason: "I am in." }, source: "serv" }],
  snapshots: [],
  entering: [{ agentId: "atlas", entrantId: "agent-atlas", stakeWei }],
  bots: ["bot-00"],
  entrants: [{ id: "agent-atlas" }, { id: "bot-00" }],
  servCalls: 6,
  guardRefusals: 0,
  rejections: [],
});

describe("PlanStore", () => {
  it("gives back exactly the plan that was quoted, bigints and all", () => {
    const s = new PlanStore(file());
    s.put(plan("r-1"));
    const got = s.require("r-1");
    expect(got.roundId).toBe("r-1");
    expect(got.stakeWei).toBe(10_000_000_000_000n);
    expect(typeof got.stakeWei).toBe("bigint");
    expect(got.entering[0].stakeWei).toBe(10_000_000_000_000n);
    expect(got.decisions[0].decision.reason).toBe("I am in.");
  });

  it("survives a restart, because a settle after a redeploy must still match the screen", () => {
    const path = file();
    new PlanStore(path).put(plan("r-1"));
    const reopened = new PlanStore(path);
    expect(reopened.require("r-1").stakeWei).toBe(10_000_000_000_000n);
  });

  it("throws on a plan it never quoted rather than letting the caller work one out", () => {
    // This is the whole point. A miss must stop the settle, because the
    // alternative is a second opinion, which is what shipped twice.
    expect(() => new PlanStore(file()).require("r-never")).toThrow(PlanNotQuoted);
  });

  it("says plainly why, so an operator is not left guessing", () => {
    expect(() => new PlanStore(file()).require("r-never")).toThrow(/never one worked out again at settle time/);
  });

  it("throws on an expired plan rather than settling against stale balances", () => {
    let t = 0;
    const s = new PlanStore(file(), { ttlMs: 1000, now: () => t });
    s.put(plan("r-1"));
    t = 999;
    expect(s.has("r-1")).toBe(true);
    t = 1001;
    expect(() => s.require("r-1")).toThrow(PlanNotQuoted);
  });

  it("replaces a re-quoted plan rather than keeping two under one id", () => {
    const s = new PlanStore(file());
    s.put(plan("r-1", 10n));
    s.put(plan("r-1", 20n));
    expect(s.require("r-1").stakeWei).toBe(20n);
  });

  it("has does not re-plan and does not throw", () => {
    const s = new PlanStore(file());
    expect(s.has("r-never")).toBe(false);
    s.put(plan("r-1"));
    expect(s.has("r-1")).toBe(true);
  });
});
