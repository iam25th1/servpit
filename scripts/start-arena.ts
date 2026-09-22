// One command that runs the pit: the built site and the worker, together.
//
//   npm run build && npm run start:arena
//
// Two processes, because they are two jobs. The site serves a page and reads
// files; the worker plays rounds, holds wallet keys open and must be the only
// one of itself. Running them in one process would put a round's settle in
// the same event loop as every page view, and a crash in either would take
// the other with it.
//
// This supervises rather than orchestrates. It starts both, restarts whichever
// one exits, and backs off when one keeps exiting so a broken configuration is
// a readable log rather than a spin. It does not manage the lock: a second
// worker is refused by the lock file the worker itself takes, which is what
// makes that refusal true for every way of starting one, not just this way.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { arenaMode, roundIntervalSeconds } from "../src/config/arena";
import { readEnv } from "../src/server/env";
import { loadLocalEnv } from "./lib/loadEnv";

/** How long after an exit a child is started again. */
const RESTART_MS = 2_000;
/** And after it has exited quickly a few times in a row. */
const BACKOFF_MS = 30_000;
/** An exit sooner than this is a failure to start rather than a crash. */
const QUICK_MS = 10_000;
const QUICK_LIMIT = 3;

interface Job {
  name: string;
  command: string;
  args: string[];
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function run(job: Job, env: NodeJS.ProcessEnv): ChildProcess {
  // Inherited, so the worker's own log and the site's output are the log of
  // this command. Nothing is swallowed and nothing is reformatted.
  return spawn(job.command, job.args, { stdio: "inherit", env });
}

/**
 * Keeps one job running until stopped.
 *
 * Quick exits are counted rather than ignored: three in a row is a
 * configuration that will not start, and hammering it hides the reason in
 * thousands of lines.
 */
async function supervise(job: Job, env: NodeJS.ProcessEnv, register: (child: ChildProcess) => void, stopped: () => boolean): Promise<void> {
  let quick = 0;
  while (!stopped()) {
    const startedAt = Date.now();
    const child = run(job, env);
    register(child);
    const code = await new Promise<number>((resolve) => {
      child.on("exit", (status, signal) => resolve(status ?? (signal ? 1 : 0)));
      child.on("error", () => resolve(1));
    });
    if (stopped()) return;
    const lived = Date.now() - startedAt;
    quick = lived < QUICK_MS ? quick + 1 : 0;
    const wait = quick >= QUICK_LIMIT ? BACKOFF_MS : RESTART_MS;
    console.log(`[start:arena] ${job.name} exited with ${code} after ${Math.round(lived / 1000)} s, starting it again in ${Math.round(wait / 1000)} s`);
    if (quick === QUICK_LIMIT) console.log(`[start:arena] ${job.name} has exited quickly ${quick} times. Read its output above before assuming this will fix itself.`);
    await sleep(wait);
  }
}

function main(): void {
  loadLocalEnv();
  // Arena mode is what this command is for. Set here rather than asked of the
  // host, so the site and the worker cannot disagree about which flow is on.
  const env: NodeJS.ProcessEnv = { ...process.env, SERVPIT_ARENA_MODE: "true" };
  const dataDir = env.SERVPIT_DATA_DIR ?? "data";
  // A fresh volume has nothing in it, and every store creates its own file.
  mkdirSync(dataDir, { recursive: true });

  const declared = readEnv(env);
  console.log(`[start:arena] arena mode ${arenaMode(env) ? "on" : "off"}, a round every ${roundIntervalSeconds(env)} s`);
  console.log(`[start:arena] data directory: ${dataDir}`);
  console.log(`[start:arena] wallets: ${declared.walletBackend} on ${declared.network}`);
  console.log(`[start:arena] site on port ${env.PORT ?? "3000"}`);

  const children = new Set<ChildProcess>();
  let stopping = false;
  const stop = (signal: NodeJS.Signals) => () => {
    if (stopping) return;
    stopping = true;
    console.log(`[start:arena] ${signal}, stopping both`);
    for (const child of children) child.kill(signal);
    // Long enough for the worker to finish the round in flight and release
    // its lock, short enough that a host's own timeout does not beat it.
    setTimeout(() => process.exit(0), 15_000).unref();
  };
  process.once("SIGINT", stop("SIGINT"));
  process.once("SIGTERM", stop("SIGTERM"));

  const register = (child: ChildProcess): void => {
    children.add(child);
    child.on("exit", () => children.delete(child));
  };

  const jobs: Job[] = [
    { name: "site", command: join("node_modules", ".bin", "next"), args: ["start"] },
    // The same entry point an operator runs by hand, so the lock, the pause
    // file and the status command all behave the same way under it.
    { name: "worker", command: process.execPath, args: ["--import", "tsx", join("scripts", "arena.ts")] },
  ];
  for (const job of jobs) void supervise(job, env, register, () => stopping);
}

main();
