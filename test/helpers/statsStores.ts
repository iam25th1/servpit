// A small set of stores, written into a temporary directory by the tests.
//
// A helper rather than part of the stats module, because this is the one file
// around the report that writes anything: the guard test asserts that nothing
// the script can reach writes at all, and a fixture living next to the code it
// tests would be the exception that hides a real one.
//
// Two tests use it: the counting test, which reads these stores, and the read
// only test, which runs the whole script against them and checks that not one
// byte changed.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Writes a small pit's worth of stores, and answers where they are. */
export function writeFixture(dir: string, network = "fake"): string {
  mkdirSync(dir, { recursive: true });
  const at = (n: number): string => new Date(Date.UTC(2026, 8, 30, 10, n)).toISOString();

  const agent = (id: string, source: string, entered: boolean, extra: Record<string, unknown> = {}) => ({
    agentId: id,
    name: id,
    entered,
    stake: entered ? 10 : 0,
    source,
    situation: { balanceChips: 50, debtChips: 0, potChips: 240, field: 24, recentEntered: 2, recentAhead: 1 },
    ...extra,
  });

  writeFileSync(
    join(dir, `rounds-${network}.json`),
    JSON.stringify({
      network,
      version: 1,
      rounds: [
        // Its own cost, which the tokens are the marker for.
        { roundId: "r-1", createdAt: at(0), entrants: 24, winner: "bot-04", potWei: "20000000000000", rakeWei: "0", servCalls: 6, servMicroCents: 1_485_000, servTokensIn: 7_200, servTokensOut: 900, reconciled: true, agents: [agent("atlas", "serv", true), agent("blaze", "serv", false)] },
        { roundId: "r-2", createdAt: at(30), entrants: 24, winner: "agent-atlas", potWei: "50000000000000", rakeWei: "0", servCalls: 0, servMicroCents: 0, reconciled: true, agents: [agent("atlas", "learned", true), agent("blaze", "heuristic", false)] },
        {
          roundId: "r-3",
          createdAt: at(60),
          entrants: 24,
          winner: "fighter-ash",
          potWei: "30000000000000",
          rakeWei: "0",
          servCalls: 0,
          servMicroCents: 0,
          reconciled: false,
          // A failure with its checks kept, which is what a round records now.
          reconciliation: {
            ran: ["wallet 0x0000000000000000000000000000000000000a11 delta", "pot delta", "conservation", "pot covers payout"],
            failed: [{ name: "wallet 0x0000000000000000000000000000000000000a11 delta", expected: "-10000000000000", actual: "-9993117944488" }],
          },
          agents: [agent("atlas", "heuristic", false), agent("blaze", "heuristic", false)],
        },
        // And one that failed before the checks were kept, so the cause is not
        // on file at all.
        { roundId: "r-4", createdAt: at(90), entrants: 24, winner: "bot-01", potWei: "10000000000000", rakeWei: "0", servCalls: 0, servMicroCents: 0, reconciled: false, agents: [agent("atlas", "heuristic", false)] },
      ],
    }),
  );

  writeFileSync(
    join(dir, `ledger-${network}.json`),
    JSON.stringify({
      network,
      version: 1,
      transfers: {
        "r-1:entry:atlas": { kind: "entry", status: "complete", amountWei: "10000000000000", feeWei: "1000000000", txHash: "0xaa", roundId: "r-1", agentId: "atlas" },
        "r-1:entry:blaze": { kind: "entry", status: "failed", amountWei: "10000000000000", feeWei: "0", roundId: "r-1", agentId: "blaze" },
        "r-2:payout:atlas": { kind: "payout", status: "complete", amountWei: "50000000000000", feeWei: "2000000000", txHash: "0xbb", roundId: "r-2", agentId: "atlas" },
        "r-2:loan:blaze": { kind: "loan", status: "complete", amountWei: "30000000000000", feeWei: "500000000", txHash: "0xcc", roundId: "r-2", agentId: "blaze" },
        "r-3:seizure:blaze": { kind: "seizure", status: "complete", amountWei: "4000000000000", feeWei: "500000000", txHash: "0xdd", roundId: "r-3", agentId: "blaze" },
      },
    }),
  );

  writeFileSync(
    join(dir, `wrecks-${network}.json`),
    JSON.stringify({
      network,
      version: 1,
      wrecks: [
        { walletId: "blaze", identityId: "blaze-1", name: "Blaze", trigger: "broke and denied credit", roundsSurvived: 27, wins: 1, peakBalanceWei: "99000000000000", debtAtDeathWei: "25000000000000", writtenOffWei: "25000000000000", seizedWei: "0", loanCount: 2, at: at(10) },
        { walletId: "comet", identityId: "comet-1", name: "Comet", trigger: "debt above the ceiling", roundsSurvived: 3, wins: 0, peakBalanceWei: "40000000000000", debtAtDeathWei: "42000000000000", writtenOffWei: "38000000000000", seizedWei: "4000000000000", loanCount: 1, at: at(40) },
      ],
      updatedAt: at(40),
    }),
  );

  writeFileSync(
    join(dir, `debts-${network}.json`),
    JSON.stringify({ network, version: 1, debts: { atlas: { principalWei: "10000000000000", interestWei: "500000000000", rateBps: 500, borrowedWei: "10000000000000", repaidWei: "0", loanCount: 1 } }, updatedAt: at(60) }),
  );

  writeFileSync(
    join(dir, `arena-${network}.json`),
    JSON.stringify({
      network,
      paused: false,
      nextRoundAt: at(90),
      updatedAt: at(61),
      round: null,
      last: {
        roundId: "r-3",
        weiPerChip: "1000000000000",
        entrants: 24,
        fight: {
          durationMs: 9_000,
          placements: ["fighter-ash", "bot-04"],
          log: [
            { type: "spawn", actor: "fighter-ash", target: null },
            { type: "death", actor: "bot-04", target: "fighter-ash" },
            { type: "death", actor: "bot-05", target: "fighter-ash" },
            { type: "win", actor: "fighter-ash", target: null },
          ],
          characters: [
            { entrantId: "fighter-ash", characterId: "NinjaWater", tier: "rare", combo: "threeOfAKind" },
            { entrantId: "bot-04", characterId: "Monk", tier: "common", combo: "none" },
          ],
        },
      },
    }),
  );

  // A plan quoted for a round that has since aged out of the round store,
  // which is the only way a reasoned round older than the window can still be
  // counted as reasoned.
  writeFileSync(
    join(dir, `plans-${network}.json`),
    JSON.stringify({
      network,
      version: 1,
      plans: [
        { planId: "r-0", quotedAt: at(-120), plan: { roundId: "r-0", decisions: [{ source: "serv", latencyMs: 7_000 }, { source: "serv", latencyMs: 9_000 }] } },
      ],
    }),
  );

  writeFileSync(
    join(dir, `picks-${network}.ndjson`),
    [
      JSON.stringify({ k: "head", network }),
      JSON.stringify({ k: "claim", handle: "ash", tokenHash: "hash-ash", at: at(1) }),
      JSON.stringify({ k: "pick", roundId: "r-1", handle: "ash", agentId: "atlas", at: at(2) }),
      JSON.stringify({ k: "pick", roundId: "r-2", handle: "ash", agentId: "atlas", at: at(31) }),
      // A line cut in half by a crash. Every whole line around it still counts.
      '{"k":"pick","roundId":"r-3","handle":"as',
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(dir, `pulls-${network}.ndjson`),
    [JSON.stringify({ k: "head", network }), JSON.stringify({ k: "claim", handle: "bowen", tokenHash: "hash-bowen", at: at(5) }), JSON.stringify({ k: "pull", handle: "bowen", tokenHash: "hash-bowen", id: "p-1", at: at(5) }), ""].join("\n"),
  );

  writeFileSync(
    join(dir, `fighters-${network}.ndjson`),
    [
      JSON.stringify({ k: "head", network }),
      JSON.stringify({ k: "claim", handle: "ash", tokenHash: "hash-ash", name: "Cinder", face: "Monk", at: at(3) }),
      JSON.stringify({ k: "claim", handle: "cass", tokenHash: "hash-cass", name: "Bruin", face: "Bear", at: at(4) }),
      JSON.stringify({ k: "release", handle: "cass", at: at(50) }),
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(dir, `careers-${network}.json`),
    JSON.stringify({ network, rows: [{ handle: "ash", name: "Cinder", face: "Monk", rounds: 40, wins: 3, best: 1, kills: 31, streak: 2, longest: 5 }], settled: ["r-1", "r-2", "r-3"] }),
  );

  writeFileSync(
    join(dir, `leaderboard-${network}.json`),
    JSON.stringify({ network, rows: [{ handle: "ash", points: 200, picks: 2, correct: 1, streak: 1, best: 2, reads: 3, readsRight: 2, perfect: 0 }], settled: ["r-1"] }),
  );

  return dir;
}
