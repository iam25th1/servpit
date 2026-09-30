// The lines worth posting, and the ones left out rather than dressed up.

import { describe, expect, it } from "vitest";
import type { Report, Stat } from "./collect";
import { POST_LINES, postLines } from "./post";

const report = (stats: Stat[]): Report => ({ network: "fake", dataDir: "/nowhere", at: "2026-09-30T00:00:00.000Z", groups: [{ title: "everything", stats }], notes: [] });

describe("picking the lines", () => {
  it("leaves out a number that is not impressive", () => {
    const lines = postLines(report([{ label: "transactions on chain", text: "12", number: 12 }]));
    expect(lines).toEqual([]);
  });

  it("says a number that is", () => {
    const lines = postLines(report([{ label: "transactions on chain", text: "4,424", number: 4_424 }]));
    expect(lines).toEqual(["Six agents with their own wallets have moved money 4,424 times on Base Sepolia. Every one of those transfers has a hash."]);
  });

  it("never says anything about a stat the stores did not record", () => {
    expect(postLines(report([{ label: "written off", text: null, why: "no wreck store" }]))).toEqual([]);
  });

  it("says every round reconciled only when none failed", () => {
    const failed = postLines(
      report([
        { label: "rounds that failed reconciliation", text: "95 of 200 on file", number: 95 },
        { label: "rounds reconciled", text: "105 of 200 on file", number: 105 },
      ]),
    );
    expect(failed).toEqual([]);

    const clean = postLines(
      report([
        { label: "rounds that failed reconciliation", text: "none of the rounds on file", number: 0 },
        { label: "rounds reconciled", text: "200 of 200 on file", number: 200 },
      ]),
    );
    expect(clean).toEqual(["Every round on file reconciled against chain balances: 200 of 200 on file."]);
  });

  it("stops at six, however much there is to say", () => {
    const lines = postLines(
      report([
        { label: "transactions on chain", text: "4,424", number: 4_424 },
        { label: "agents wrecked", text: "3,873", number: 3_873 },
        { label: "what finished them", text: "5 over the ceiling, 3,868 broke" },
        { label: "best fighter career", text: "cupcake, 55 wins", number: 55 },
        { label: "moved in total", text: "84,306 chips", number: 84_306 },
        { label: "largest pot on file", text: "760 chips", number: 760 },
        { label: "written off", text: "1,136 chips", number: 1_136 },
        { label: "kills recorded for claimed fighters (the only kills any store keeps)", text: "2,681", number: 2_681 },
        { label: "what those rounds cover", text: "10.0 hours, ending now", number: 10 },
      ]),
    );
    expect(lines).toHaveLength(POST_LINES);
    expect(lines.join(" ")).not.toContain("kills recorded");
  });

  it("asks for fewer when fewer are wanted", () => {
    const lines = postLines(
      report([
        { label: "transactions on chain", text: "4,424", number: 4_424 },
        { label: "agents wrecked", text: "3,873", number: 3_873 },
      ]),
      1,
    );
    expect(lines).toHaveLength(1);
  });
});
