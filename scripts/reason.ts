// Reason rounds on purpose, up to a count, at a price stated before anything runs.
//
//   npm run reason -- 10                    take reasoned rounds up to 10, after confirming the price
//   npm run reason -- 10 --dry-run          only say what it would cost
//   npm run reason -- 10 --yes              skip the confirmation
//   npm run reason -- 10 --per-round 0.0209 price it by this when nothing on file has a measured cost
//   npm run reason -- 10 --max-spend 0.50   stop once this much has been spent, in dollars
//
// "Reasoned" is counted exactly as npm run stats counts it, from the same
// stores. The price is measured: the average of what reasoned rounds on file
// cost, each its own figure, never a guess from a rate card.
//
// How it runs: it turns scheduled reasoning on, which every process reads at
// the start of every round, watches the round store as rounds settle, prints
// each one with what it cost, and puts the switch back the way it found it
// when the count is reached, the spend cap is hit, rounds stop reasoning, or
// on Ctrl-C. It writes that one switch file and nothing else: no wallet, no
// key, no store. The worker's own gates stay in charge, so the daily budget
// (npm run pulls -- budget) and the master switch (npm run serv) still hold.

import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { roundIntervalSeconds } from "../src/config/arena";
import { pullSettingsFile } from "../src/config/pulls";
import { SERV_OFF_FILE, SERV_SCHEDULED_FILE } from "../src/config/serv";
import { heartbeatAt } from "../src/server/arena/lock";
import { HEARTBEAT_MARGIN_MS } from "../src/server/arena/health";
import { readEnv } from "../src/server/env";
import { budgetState } from "../src/server/pulls/budget";
import { readPullSettings } from "../src/server/pulls/settings";
import { RoundStore } from "../src/server/round/store";
import { dollars, measuredRate, microCentsFromDollars, newRounds, planRun, reasonedSoFar, shouldStop } from "../src/server/serv/reasonTo";
import { scheduledReasoningOn, servReasoningOn, setScheduledReasoning } from "../src/server/serv/switch";
import { loadStores } from "../src/server/stats/read";
import { loadLocalEnv } from "./lib/loadEnv";

const POLL_MS = 10_000;

interface Args {
  target: number;
  dryRun: boolean;
  yes: boolean;
  perRound: number | null;
  maxSpend: number | null;
}

function parseArgs(argv: readonly string[]): Args {
  const valueOf = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i < 0) return null;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new RangeError(`${flag} needs a value`);
    return v;
  };
  const positional = argv.filter((a, i) => !a.startsWith("--") && !["--per-round", "--max-spend"].includes(argv[i - 1] ?? ""));
  const target = Number(positional[0]);
  if (!Number.isInteger(target) || target < 1 || target > 1_000) throw new RangeError("give the reasoned-round count to reach, a whole number from 1 to 1000. Example: npm run reason -- 10");
  const per = valueOf("--per-round");
  const cap = valueOf("--max-spend");
  return {
    target,
    dryRun: argv.includes("--dry-run"),
    yes: argv.includes("--yes"),
    perRound: per === null ? null : microCentsFromDollars(per),
    maxSpend: cap === null ? null : microCentsFromDollars(cap),
  };
}

const wait = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

async function main(): Promise<void> {
  loadLocalEnv();
  const env = readEnv();
  const network = env.viem ? "base-sepolia" : "fake";
  const args = parseArgs(process.argv.slice(2));
  const offFile = join(env.dataDir, SERV_OFF_FILE);
  const scheduledFile = join(env.dataDir, SERV_SCHEDULED_FILE);

  const stores = loadStores(env.dataDir, network);
  const have = reasonedSoFar(stores);
  const rate = measuredRate(stores);
  const settings = readPullSettings(pullSettingsFile(env.dataDir));
  // The same reading the worker makes before every round, from the same store.
  const budget = budgetState(new RoundStore(join(env.dataDir, `rounds-${network}.json`), network).all(), settings.dailyBudgetCents, Date.now());
  const plan = planRun({
    target: args.target,
    have,
    perRoundMicroCents: args.perRound ?? rate?.perRoundMicroCents ?? null,
    capMicroCents: args.maxSpend,
    budgetLeftMicroCents: budget.budgetMicroCents - budget.spentMicroCents,
  });

  console.log(`network: ${network}`);
  console.log(`reasoned rounds so far: ${have}, counted as npm run stats counts them`);
  if (plan.need === 0) {
    console.log(`already at ${args.target} or more. Nothing to do.`);
    return;
  }
  console.log(`to reach ${args.target}: ${plan.need} more reasoned round${plan.need === 1 ? "" : "s"}`);
  if (args.perRound !== null) console.log(`price per round: ${dollars(args.perRound)}, as given`);
  else if (rate !== null) console.log(`price per round: ${dollars(rate.perRoundMicroCents)}, measured over ${rate.rounds} reasoned round${rate.rounds === 1 ? "" : "s"} on file (${rate.calls} calls)`);
  else console.log("price per round: not measured. No reasoned round on file records its own cost. Give one with --per-round, for example the SERV console's figure.");
  if (plan.estimateMicroCents !== null) console.log(`estimate: ${dollars(plan.estimateMicroCents)} for ${plan.need} round${plan.need === 1 ? "" : "s"}`);
  if (plan.capMicroCents !== null) console.log(`stops at: ${dollars(plan.capMicroCents)} spent${args.maxSpend === null ? " (twice the estimate; change it with --max-spend)" : ""}`);
  console.log(`today's reasoning budget: ${dollars(budget.spentMicroCents)} of ${dollars(budget.budgetMicroCents)} spent`);
  if (plan.budgetCovers !== null && plan.budgetCovers < plan.need) {
    console.log(`the rest of today's budget covers about ${plan.budgetCovers} round${plan.budgetCovers === 1 ? "" : "s"}. Past that the worker plays on instinct. Raise it first with: npm run pulls -- budget <cents>`);
  }
  if (!servReasoningOn(offFile)) console.log("SERV reasoning is OFF, the master switch, so nothing will reason. Turn it on with: npm run serv -- on");
  if (!env.serv) console.log("no SERV_API_KEY is configured, so nothing will reason.");
  const beat = heartbeatAt(env.dataDir, network);
  const alive = beat !== null && Date.now() - beat <= roundIntervalSeconds() * 1_000 + HEARTBEAT_MARGIN_MS;
  if (!alive) console.log("the arena worker is not running, so no rounds will play. Start it with: npm run start:arena");
  if ((stores.arena as { paused?: boolean } | null)?.paused === true) console.log("the pit is paused, so no rounds will play.");

  if (args.dryRun) return;
  if (!servReasoningOn(offFile) || !env.serv || !alive) {
    process.exitCode = 1;
    return;
  }
  if (plan.capMicroCents === null) {
    console.log("refusing to run without a price or a cap. Give --per-round or --max-spend.");
    process.exitCode = 1;
    return;
  }
  if (!args.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`go ahead? scheduled rounds will reason until ${plan.need} more have, or ${dollars(plan.capMicroCents)} is spent [y/N] `)).trim().toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      console.log("nothing changed.");
      return;
    }
  }

  // Put the switch back the way it was found, however the run ends.
  const wasOn = scheduledReasoningOn(scheduledFile);
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    setScheduledReasoning(scheduledFile, wasOn);
    console.log(wasOn ? "scheduled reasoning left on, as it was." : "scheduled reasoning back off.");
  };
  const interrupted = (): void => {
    console.log("\nstopped.");
    restore();
    process.exit(130);
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);

  const since = Date.now();
  setScheduledReasoning(scheduledFile, true);
  console.log(`scheduled reasoning on. Watching rounds as they settle, every ${POLL_MS / 1000} s. Ctrl-C stops and switches it back.`);

  const reported = new Set<string>();
  let reasoned = 0;
  let spent = 0;
  let calls = 0;
  let unreasonedInARow = 0;
  try {
    for (;;) {
      await wait(POLL_MS);
      for (const round of newRounds(loadStores(env.dataDir, network), since, reported)) {
        reported.add(round.roundId);
        spent += round.microCents;
        calls += round.calls;
        if (round.reasoned) {
          reasoned += 1;
          unreasonedInARow = 0;
        } else {
          unreasonedInARow += 1;
        }
        console.log(`${round.roundId}  ${round.reasoned ? "reasoned" : "instinct"}  ${round.calls} calls  ${dollars(round.microCents)}   ${reasoned} of ${plan.need}, ${dollars(spent)} spent`);
      }
      const verdict = shouldStop({ reasoned, need: plan.need, spentMicroCents: spent, capMicroCents: plan.capMicroCents, unreasonedInARow });
      if (!verdict.stop) continue;
      if (verdict.why === "cap") console.log(`spend cap reached at ${dollars(spent)}.`);
      if (verdict.why === "unreasoned") console.log("rounds stopped reasoning: the daily budget may be spent, SERV may be failing, or the switch was turned off. Check: npm run pulls -- status");
      break;
    }
  } finally {
    restore();
  }
  console.log(`done: ${reasoned} reasoned round${reasoned === 1 ? "" : "s"}, ${calls} calls, ${dollars(spent)} measured, ${reasoned > 0 ? `${dollars(Math.round(spent / reasoned))} a reasoned round` : "nothing reasoned"}.`);
  console.log(`reasoned rounds now: ${reasonedSoFar(loadStores(env.dataDir, network))}. The SERV console is the authority on the bill.`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
