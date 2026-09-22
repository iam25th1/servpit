// The pit, playing itself.
//
// One process, one writer. It plays a round every interval using the same
// planRound and runRound the lever route uses, publishes where it is as it
// goes, and rests until the next one.
//
//   SERVPIT_ARENA_MODE=true npm run arena
//
// It also answers about itself, without starting anything:
//
//   npm run arena -- status    what the pit is doing and when the next round is
//   npm run arena -- pause     stop after the round in flight
//   npm run arena -- resume    start again at the next interval
//
// The loop itself lives in src/server/arena/worker.ts, so it can be driven by
// a test. What is here is the part an operator sees: the environment, the
// lock, the signals and what it prints.

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PAUSE_FILE, arenaMode, roundIntervalSeconds } from "../src/config/arena";
import { SERV_OFF_FILE } from "../src/config/serv";
import { servReasoningOn } from "../src/server/serv/switch";
import { getServerContext } from "../src/server/context";
import { readEnv } from "../src/server/env";
import { log } from "../src/server/log";
import { ArenaStore, arenaFile } from "../src/server/arena/state";
import { ArenaAlreadyRunning, arenaLockFile, holdArenaLock } from "../src/server/arena/lock";
import { runArenaLoop } from "../src/server/arena/worker";
import { loadLocalEnv } from "./lib/loadEnv";
import { requireDeclaredBackend } from "./lib/requireBackend";

const envFile = loadLocalEnv();

type Command = "run" | "pause" | "resume" | "status";

function commandFrom(argv: readonly string[]): Command {
  const raw = argv[2]?.trim().toLowerCase();
  if (raw === undefined || raw.length === 0) return "run";
  if (raw === "pause" || raw === "resume" || raw === "status") return raw;
  throw new RangeError(`unknown command ${raw}. Use pause, resume, status, or no command to run the worker.`);
}

/**
 * The commands that only touch the pause file and the arena file.
 *
 * Deliberately without the server context: pausing a running pit must not
 * open wallets, reach the chain or build a SERV client, and an operator
 * should be able to ask what is going on while a round is settling.
 */
function operate(command: Exclude<Command, "run">, dataDir: string, network: string): void {
  const pauseFile = join(dataDir, PAUSE_FILE);
  if (command === "pause") writeFileSync(pauseFile, `paused since ${new Date().toISOString()}\n`, { mode: 0o600 });
  if (command === "resume") rmSync(pauseFile, { force: true });

  const paused = existsSync(pauseFile);
  const state = new ArenaStore(arenaFile(dataDir, network), network).read();
  console.log(paused ? "The pit is paused. The round in flight finishes, then it rests." : "The pit is running.");
  console.log(`arena mode: ${arenaMode() ? "on" : "off"}, a round every ${roundIntervalSeconds()} s`);
  // A round has no id until its plan lands, so the phase is the whole answer
  // for the first few seconds of one.
  if (state.round) console.log(`current round: phase ${state.round.phase}${state.round.roundId ? `, ${state.round.roundId}` : ""}`);
  if (state.nextRoundAt && !paused) console.log(`next round at: ${state.nextRoundAt}`);
  console.log(`serv reasoning: ${servReasoningOn(join(dataDir, SERV_OFF_FILE)) ? "on" : "off"}, change it with npm run serv -- on|off`);
  console.log(`pause file: ${pauseFile}`);
}

async function main(): Promise<void> {
  const env = readEnv();
  const command = commandFrom(process.argv);
  if (command !== "run") {
    operate(command, env.dataDir, env.network);
    return;
  }
  requireDeclaredBackend(env, envFile);
  if (!arenaMode()) {
    console.log("SERVPIT_ARENA_MODE is not true, so there is nothing for the worker to do. The lever starts rounds.");
    return;
  }

  const ctx = await getServerContext();
  const store = new ArenaStore(arenaFile(env.dataDir, ctx.chain.network), ctx.chain.network);
  const pauseFile = join(env.dataDir, PAUSE_FILE);

  let lock;
  try {
    lock = holdArenaLock(arenaLockFile(env.dataDir, ctx.chain.network));
  } catch (e) {
    if (e instanceof ArenaAlreadyRunning) {
      console.error(e.message);
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  let running = true;
  const stop = (signal: string) => () => {
    log.info("arena worker stopping", { signal });
    running = false;
  };
  process.once("SIGINT", stop("SIGINT"));
  process.once("SIGTERM", stop("SIGTERM"));

  console.log(`arena worker on ${ctx.chain.kind} (${ctx.chain.network}), a round every ${roundIntervalSeconds()} s`);
  console.log(`pause with: npm run arena -- pause`);

  try {
    const counts = await runArenaLoop({
      ctx,
      store,
      pauseFile,
      intervalMs: roundIntervalSeconds() * 1_000,
      maxRounds: Number.parseInt(process.env.SERVPIT_ARENA_MAX_ROUNDS ?? "0", 10),
      running: () => running,
      beat: () => lock.beat(),
    });
    console.log(`arena worker stopped: ${counts.played} played, ${counts.failed} failed, ${counts.rested} rested`);
  } finally {
    lock.release();
  }
}

main().catch((e) => {
  log.error("arena worker stopped on an error", { error: e instanceof Error ? e.message : String(e) });
  process.exitCode = 1;
});
