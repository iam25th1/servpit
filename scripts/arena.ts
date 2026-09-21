// The pit, playing itself.
//
// One process, one writer. It plays a round every interval using the same
// planRound and runRound the lever route uses, publishes where it is as it
// goes, and rests until the next one.
//
//   SERVPIT_ARENA_MODE=true npm run arena
//
// The loop itself lives in src/server/arena/worker.ts, so it can be driven by
// a test. What is here is the part an operator sees: the environment, the
// lock, the signals and what it prints.

import { join } from "node:path";
import { PAUSE_FILE, arenaMode, roundIntervalSeconds } from "../src/config/arena";
import { getServerContext } from "../src/server/context";
import { readEnv } from "../src/server/env";
import { log } from "../src/server/log";
import { ArenaStore, arenaFile } from "../src/server/arena/state";
import { ArenaAlreadyRunning, arenaLockFile, holdArenaLock } from "../src/server/arena/lock";
import { runArenaLoop } from "../src/server/arena/worker";
import { loadLocalEnv } from "./lib/loadEnv";
import { requireDeclaredBackend } from "./lib/requireBackend";

const envFile = loadLocalEnv();

async function main(): Promise<void> {
  const env = readEnv();
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
  console.log(`pause with: touch ${pauseFile}`);

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
