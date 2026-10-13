// Reason rounds on purpose, up to a count, at a price stated before anything runs.
//
//   npm run reason -- 10                    take reasoned rounds up to 10, after confirming the price
//   npm run reason -- 10 --dry-run          only say what it would cost
//   npm run reason -- 10 --yes              skip the confirmation
//   npm run reason -- 10 --per-round 0.0209 price it by this when nothing on file has a measured cost
//   npm run reason -- 10 --max-spend 0.50   stop once this much has been spent, in dollars
//   npm run reason -- 92 --fast             play the rounds here, back to back, with no show
//
// "Reasoned" is counted exactly as npm run stats counts it, from the same
// stores. The price is measured: the average of what reasoned rounds on file
// cost, each its own figure, never a guess from a rate card.
//
// Two ways to run. Without --fast it turns the switch on and watches the
// worker, which plays one round an interval, so a hundred rounds is hours.
// With --fast it pauses the worker and plays the rounds itself, back to back,
// by the same planRound and runRound path with the spectator show turned off:
// the same settle lock, the same stores, the same permanent line per round.
// One round at a time, because six wallets sending under their own nonces and
// one settle lock make overlapping rounds a way to pay twice.
//
// How the watching mode runs: it turns scheduled reasoning on, which every process reads at
// the start of every round, watches the round store as rounds settle, prints
// each one with what it cost, and puts the switch back the way it found it
// when the count is reached, the spend cap is hit, rounds stop reasoning, or
// on Ctrl-C. It writes that one switch file and nothing else: no wallet, no
// key, no store. The worker's own gates stay in charge, so the daily budget
// (npm run pulls -- budget) and the master switch (npm run serv) still hold.

import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { PAUSE_FILE, roundIntervalSeconds } from "../src/config/arena";
import { pullSettingsFile } from "../src/config/pulls";
import { SERV_OFF_FILE, SERV_SCHEDULED_FILE } from "../src/config/serv";
import { ArenaStore, arenaFile } from "../src/server/arena/state";
import { playArenaRound } from "../src/server/arena/worker";
import { getServerContext } from "../src/server/context";
import { heartbeatAt } from "../src/server/arena/lock";
import { HEARTBEAT_MARGIN_MS } from "../src/server/arena/health";
import { readEnv } from "../src/server/env";
import { budgetState } from "../src/server/pulls/budget";
import { readPullSettings } from "../src/server/pulls/settings";
import { RoundStore } from "../src/server/round/store";
import { MEASURE_AFTER, TIME_BUDGET_MS, budgetCentsFor, expectedRoundMs, saidAs, workMsOf } from "../src/server/serv/fastRun";
import { fastMode } from "../src/server/serv/fastMode";
import { dollars, measuredRate, microCentsFromDollars, newRounds, planRun, reasonedSoFar, shouldStop } from "../src/server/serv/reasonTo";
import { scheduledReasoningOn, servReasoningOn, setScheduledReasoning } from "../src/server/serv/switch";
import { loadStores } from "../src/server/stats/read";
import { loadLocalEnv } from "./lib/loadEnv";

const POLL_MS = 10_000;

/** Where the run writes a line per round, beside the terminal. */
const LOG_FILE = "reason.log";

interface Args {
  target: number;
  dryRun: boolean;
  yes: boolean;
  fast: boolean;
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
    fast: argv.includes("--fast"),
    perRound: per === null ? null : microCentsFromDollars(per),
    maxSpend: cap === null ? null : microCentsFromDollars(cap),
  };
}

const wait = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

/**
 * The fast run: pause the worker, play the rounds here, put everything back.
 *
 * The round itself is playArenaRound with the show off, which is the worker's
 * own function: the same plan, the same settle under the same lock, the same
 * round store, summaries, backing, reads and fighter records. What a round
 * records is what counts it, so the count comes from reading each round back
 * out of the store rather than from what this asked for.
 */
async function runFastMode(input: {
  env: ReturnType<typeof readEnv>;
  network: string;
  plan: ReturnType<typeof planRun>;
  cap: number;
  spentTodayMicroCents: number;
  yes: boolean;
}): Promise<void> {
  const { env, network, plan } = input;
  const ctx = await getServerContext();
  const store = new ArenaStore(arenaFile(env.dataDir, network), network);
  const say = (line: string): void => {
    console.log(line);
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
  };

  // A signal stops the run at the next round boundary rather than in the
  // middle of a settle. A second one gives up waiting, and the restore runs
  // either way: fastMode puts its three files back in a finally.
  let keepGoing = true;
  let asking = false;
  const stop = (signal: string): void => {
    if (!keepGoing) {
      say(`${signal} again: giving up on the round in flight.`);
      process.exit(130);
    }
    keepGoing = false;
    say(`${signal}: stopping after this round. ${signal} again to give up on it.`);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  say(`fast run starting: ${plan.need} reasoned round${plan.need === 1 ? "" : "s"} to add, cap ${dollars(input.cap)}, network ${network}.`);

  const outcome = await fastMode({
    dataDir: env.dataDir,
    need: plan.need,
    capMicroCents: input.cap,
    spentTodayMicroCents: input.spentTodayMicroCents,
    backupTo: `${LOG_FILE.replace(/\.log$/, "")}-pull-settings.backup.json`,
    arenaState: () => {
      const state = store.read();
      return { paused: state.paused === true, phase: state.round?.phase ?? null };
    },
    play: async () => {
      // nextAt is now: with the show off there is no dwell to cut short, and
      // nothing is waiting for the next round but this loop.
      const outcomeOfRound = await playArenaRound(ctx, store, Date.now(), null, { show: false });
      if (outcomeOfRound !== "played") throw new Error(`the pit did not play a round: ${outcomeOfRound}`);
      const latest = ctx.flow.store.all().at(-1);
      if (latest === undefined) throw new Error("the round store has no round after playing one");
      return latest.roundId;
    },
    read: (roundId) => {
      const row = ctx.flow.store.get(roundId);
      if (row === undefined) return null;
      return {
        reasoned: (row.agents ?? []).some((a) => a.source === "serv"),
        calls: row.servCalls ?? 0,
        // Its own figure only. A row with no token counts carries the meter's
        // running total, which is not this round's cost.
        microCents: row.servTokensIn !== undefined && typeof row.servMicroCents === "number" ? row.servMicroCents : 0,
      };
    },
    onRound: (row) => {
      say(
        `${row.roundId}  ${row.reasoned ? "reasoned" : "instinct"}  ${row.calls} calls  ${dollars(row.microCents)}  ${row.reasonedSoFar} of ${plan.need}  ${dollars(row.spentMicroCents)} spent  ${row.seconds.toFixed(1)} s`,
      );
    },
    overTime: async (projectedMs, perRoundSeconds) => {
      say(`measured ${perRoundSeconds.toFixed(1)} s a round, so the rest will take about ${saidAs(projectedMs)}, over the ${saidAs(TIME_BUDGET_MS)} this was meant to fit in.`);
      if (input.yes) {
        say("carrying on, because --yes was given.");
        return true;
      }
      asking = true;
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await rl.question("carry on? [y/N] ")).trim().toLowerCase();
      rl.close();
      asking = false;
      return answer === "y" || answer === "yes";
    },
    running: () => keepGoing && !asking,
    say,
  });

  const { result } = outcome;
  const why = {
    target: "the target was reached",
    cap: "the spend cap was reached",
    unreasoned: "three rounds in a row came back on instinct, so something is wrong that another round will not fix",
    time: "it was over the time budget and the answer was no",
    stopped: "it was stopped",
  }[result.why];
  say(
    `done: ${result.reasoned} reasoned of ${result.played} played, ${result.calls} calls, ${dollars(result.spentMicroCents)} measured, ${saidAs(result.elapsedMs)} elapsed, ${(result.elapsedMs / 1_000 / Math.max(1, result.played)).toFixed(1)} s a round. ${why}.`,
  );
  for (const row of outcome.restored) say(row.error === null ? `put back: ${row.name}` : `could not put back ${row.name}: ${row.error}`);
  if (outcome.paused) say("the pit is running again.");
  else say("the pit was paused before this run and is still paused.");
  say(`reasoned rounds now: ${reasonedSoFar(loadStores(env.dataDir, network))}. The SERV console is the authority on the bill.`);
  if (result.why === "unreasoned") process.exitCode = 1;
}

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
  if (!alive) {
    console.log(
      args.fast
        ? "the arena worker is not running, which a fast run does not need: it is the player, and it will pause nothing that is not there."
        : "the arena worker is not running, so no rounds will play. Start it with: npm run start:arena",
    );
  }
  if ((stores.arena as { paused?: boolean } | null)?.paused === true) console.log("the pit is paused, so no rounds will play.");

  // What a fast run adds to the plan: the pace, the clock, and the three
  // things it changes and changes back.
  const settingsFile = pullSettingsFile(env.dataDir);
  const budgetWould = budgetCentsFor({
    spentTodayMicroCents: budget.spentMicroCents,
    capMicroCents: plan.capMicroCents ?? 0,
    currentCents: settings.dailyBudgetCents,
  });
  if (args.fast) {
    // Measured from this pit's own last round rather than assumed: planning to
    // reels is the plan and the settle, which is all a fast round does, and
    // the measured decision phase is added when that round ran on instinct.
    const lastRound = (stores.arena as { last?: { phases?: Array<{ phase: string; at: string }>; reasoning?: boolean } } | null)?.last;
    const perRoundMs = expectedRoundMs({ workMs: workMsOf(lastRound?.phases), reasoned: lastRound?.reasoning === true });
    const expectedMs = plan.need * perRoundMs;
    console.log("");
    console.log(`fast mode: this process plays the rounds itself, back to back, with the spectator show off.`);
    console.log(`  one round at a time, because six wallets send under their own nonces and one settle lock makes overlapping rounds a way to pay twice.`);
    console.log(`  the same planRound, runRound, settle lock, stores and permanent line as a worker round. Real SERV calls, real settlement on ${network}.`);
    console.log(
      `projected time: about ${saidAs(expectedMs)} for ${plan.need} round${plan.need === 1 ? "" : "s"}, at ${(perRoundMs / 1_000).toFixed(1)} s a round${
        lastRound === undefined ? " (nothing on file to measure, so this is the fallback)" : `, from this pit's own last round${lastRound.reasoning === true ? "" : " plus the measured decision phase, since that one ran on instinct"}`
      }.`,
    );
    console.log(`  measured for real after ${MEASURE_AFTER} rounds, and if the projection is over ${saidAs(TIME_BUDGET_MS)} it asks whether to carry on.`);
    if (expectedMs > TIME_BUDGET_MS) console.log(`  that is over ${saidAs(TIME_BUDGET_MS)} already. A lower target would fit: about ${Math.floor(TIME_BUDGET_MS / perRoundMs)} rounds.`);
    console.log(`it changes three things and puts all three back on any exit:`);
    console.log(`  the pause file ${join(env.dataDir, PAUSE_FILE)}${(stores.arena as { paused?: boolean } | null)?.paused === true ? ", which is already set, so it is left set" : ""}`);
    console.log(
      budgetWould === settings.dailyBudgetCents
        ? `  the daily reasoning budget in ${settingsFile} stays at ${settings.dailyBudgetCents} cents, which already covers the run`
        : `  the daily reasoning budget in ${settingsFile}, ${settings.dailyBudgetCents} to ${budgetWould} cents for the run`,
    );
    console.log(`  the scheduled reasoning switch ${scheduledFile}`);
    console.log(`a line per round goes to the terminal and to ${LOG_FILE}.`);
  }

  if (args.dryRun) return;
  // A fast run is the writer, so it does not need the worker to be alive. It
  // does need the master switch and a key, like any round that reasons.
  if (!servReasoningOn(offFile) || !env.serv || (!args.fast && !alive)) {
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
    const what = args.fast
      ? `go ahead? the worker pauses and this process plays rounds until ${plan.need} more have reasoned, or ${dollars(plan.capMicroCents)} is spent [y/N] `
      : `go ahead? scheduled rounds will reason until ${plan.need} more have, or ${dollars(plan.capMicroCents)} is spent [y/N] `;
    const answer = (await rl.question(what)).trim().toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      console.log("nothing changed.");
      return;
    }
  }

  if (args.fast) {
    await runFastMode({ env, network, plan, cap: plan.capMicroCents, spentTodayMicroCents: budget.spentMicroCents, yes: args.yes });
    return;
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
