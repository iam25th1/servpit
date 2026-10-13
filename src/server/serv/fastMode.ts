// Everything a fast run touches outside a round, and how it puts it back.
//
// Three files: the pause file, so the worker is not playing while this is; the
// daily reasoning budget, so the run is not cut off by a gate meant for an
// unattended pit; and the scheduled switch, which is what tells a round it may
// reason. Nothing else in the data directory is written here. The rounds
// themselves write what any round writes, by the ordinary path.
//
// The order matters. Pause first and wait for the worker to say it has seen
// the pause file, because two writers on six wallets is how a nonce gets used
// twice. Then raise the budget and turn the switch on, which are both cheap to
// undo. Undo everything on the way out, whether the run finished, failed or
// was interrupted, and leave the pause file alone if the operator had already
// paused the pit: this run did not pause it and does not get to resume it.
//
// What counts as quiet is the part worth being careful about. A phase of
// "resting" is not enough while a worker is alive: the loop reads the pause
// file once at the top of an interval and then awaits a funds check, which is
// several balance reads over the network, before it publishes "planning". A
// pause file written into that gap leaves the arena file saying "resting"
// while a round is about to start, and a runner that trusted the phase would
// play beside it. So while the worker is alive the only quiet is the pit
// reading paused, which the worker writes itself when it sees the file. The
// phase alone is enough only when there is no worker to race.

import { copyFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PAUSE_FILE, roundIntervalSeconds } from "@/config/arena";
import { pullSettingsFile } from "@/config/pulls";
import { HEARTBEAT_MARGIN_MS } from "@/server/arena/health";
import { SERV_SCHEDULED_FILE } from "@/config/serv";
import { readPullSettings, writePullSettings } from "@/server/pulls/settings";
import { scheduledReasoningOn, setScheduledReasoning } from "./switch";
import { Restorer, budgetCentsFor, runFast, type FastDeps, type FastResult } from "./fastRun";

/**
 * How long to allow for a round already in flight to finish settling.
 *
 * Six minutes: a round is about a minute of plan and settle, and a transfer
 * that has to be read back or resent can add minutes to that.
 */
export const ROUND_SETTLE_ALLOWANCE_MS = 6 * 60_000;

/**
 * How long to wait for the worker to acknowledge the pause.
 *
 * A whole interval, because the loop reads the pause file once per interval
 * and a file written a moment after that read waits for the next one, plus the
 * margin a heartbeat is allowed, plus the round in flight. Shorter than this
 * would give up on a pit that was about to stop on its own.
 */
export function pauseWaitMsFor(intervalMs: number, marginMs: number): number {
  return Math.max(0, intervalMs) + Math.max(0, marginMs) + ROUND_SETTLE_ALLOWANCE_MS;
}

/** How often the arena file is read while waiting for that. */
export const PAUSE_POLL_MS = 5_000;

export interface FastModeInput extends Pick<FastDeps, "need" | "capMicroCents" | "play" | "read" | "onRound" | "overTime" | "running" | "now"> {
  dataDir: string;
  /** What today has already spent on reasoning, for the budget it needs. */
  spentTodayMicroCents: number;
  /** Where the settings file is copied before it is changed. Outside the data directory. */
  backupTo?: string;
  /** The arena state, read each time the wait polls it. */
  arenaState: () => { paused: boolean; phase: string | null };
  /**
   * Whether a worker is alive, read each time the wait polls.
   *
   * Read rather than passed, because a worker can stop during the wait and
   * because the answer decides what counts as quiet: with a worker alive,
   * only the pit reading paused will do.
   */
  workerAlive?: () => boolean;
  /** Told what the run is doing between rounds. */
  say: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  pauseWaitMs?: number;
  pollMs?: number;
}

export interface FastModeOutcome {
  result: FastResult;
  /** Whether this run is the one that paused the pit. */
  paused: boolean;
  /** What the budget was raised to, in cents, and what it was. */
  budget: { was: number; raisedTo: number };
  scheduledWasOn: boolean;
  restored: Array<{ name: string; error: string | null }>;
  /** True when the wait for a round in flight gave up rather than seeing it stop. */
  waitTimedOut: boolean;
}

const waitMs = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, Math.max(0, ms)));

/**
 * Pauses the pit, plays the rounds, and puts everything back.
 *
 * The restore runs in a finally, so a round that throws still leaves the
 * budget, the switch and the pause file as they were found. Each undo is
 * attempted even when another fails, and what failed is reported rather than
 * swallowed: a budget left raised is the kind of thing noticed a week later.
 */
export async function fastMode(input: FastModeInput): Promise<FastModeOutcome> {
  const sleep = input.sleep ?? waitMs;
  const pauseFile = join(input.dataDir, PAUSE_FILE);
  const scheduledFile = join(input.dataDir, SERV_SCHEDULED_FILE);
  const settingsFile = pullSettingsFile(input.dataDir);
  const restorer = new Restorer();
  let waitTimedOut = false;

  // Pause, unless the operator already had. A pit somebody else paused is
  // left paused on the way out.
  const pausedAlready = existsSync(pauseFile);
  if (!pausedAlready) {
    writeFileSync(pauseFile, `paused by npm run reason --fast since ${new Date().toISOString()}\n`, { mode: 0o600 });
    restorer.add("the pause file", () => rmSync(pauseFile, { force: true }));
    input.say("arena paused. Waiting for the round in flight to settle.");
  } else {
    input.say("the pit was already paused, so it is left that way at the end.");
  }

  const settingsWas = readPullSettings(settingsFile);
  const scheduledWasOn = scheduledReasoningOn(scheduledFile);
  const raisedTo = budgetCentsFor({ spentTodayMicroCents: input.spentTodayMicroCents, capMicroCents: input.capMicroCents, currentCents: settingsWas.dailyBudgetCents });

  try {
    // Wait for the worker to stop writing. It reads the pause file once an
    // interval, so a file written just after that read waits for the next one,
    // and a round already running finishes first.
    const until = (input.now ?? Date.now)() + (input.pauseWaitMs ?? pauseWaitMsFor(roundIntervalSeconds() * 1_000, HEARTBEAT_MARGIN_MS));
    for (;;) {
      const state = input.arenaState();
      const alive = input.workerAlive?.() ?? false;
      // With a worker alive, paused is the only quiet: a phase of resting can
      // be a worker that has already passed its pause check and is reading
      // balances before it publishes planning.
      const quiet = alive ? state.paused : state.paused || state.phase === null || state.phase === "resting";
      if (quiet) break;
      if ((input.now ?? Date.now)() >= until) {
        waitTimedOut = true;
        input.say(
          alive
            ? "the worker has not acknowledged the pause after the wait. Stopping rather than playing beside it."
            : "the round in flight has not settled after the wait. Stopping rather than playing beside it.",
        );
        break;
      }
      input.say(
        alive
          ? `waiting for the worker to acknowledge the pause: the pit reads ${state.phase ?? "no round"}, paused ${state.paused}. It reads the pause file once an interval.`
          : `waiting: no worker is alive and the pit is in the ${state.phase ?? "no"} phase.`,
      );
      await sleep(input.pollMs ?? PAUSE_POLL_MS);
    }

    if (waitTimedOut) {
      return {
        result: { played: 0, reasoned: 0, calls: 0, spentMicroCents: 0, elapsedMs: 0, why: "stopped" },
        paused: !pausedAlready,
        budget: { was: settingsWas.dailyBudgetCents, raisedTo: settingsWas.dailyBudgetCents },
        scheduledWasOn,
        restored: restorer.restore(),
        waitTimedOut,
      };
    }

    if (raisedTo !== settingsWas.dailyBudgetCents) {
      if (input.backupTo !== undefined && existsSync(settingsFile)) copyFileSync(settingsFile, input.backupTo);
      writePullSettings(settingsFile, { ...settingsWas, dailyBudgetCents: raisedTo });
      restorer.add("the daily reasoning budget", () => writePullSettings(settingsFile, settingsWas));
      input.say(`daily reasoning budget raised from ${settingsWas.dailyBudgetCents} to ${raisedTo} cents for this run.`);
    }

    if (!scheduledWasOn) {
      setScheduledReasoning(scheduledFile, true);
      restorer.add("the scheduled reasoning switch", () => setScheduledReasoning(scheduledFile, scheduledWasOn));
      input.say("scheduled reasoning on.");
    }

    const result = await runFast({
      need: input.need,
      capMicroCents: input.capMicroCents,
      play: input.play,
      read: input.read,
      onRound: input.onRound,
      overTime: input.overTime,
      running: input.running,
      now: input.now,
    });

    return { result, paused: !pausedAlready, budget: { was: settingsWas.dailyBudgetCents, raisedTo }, scheduledWasOn, restored: restorer.restore(), waitTimedOut };
  } finally {
    // Whatever happened, including a throw on the way through. Restoring
    // twice is a no op, so the success path above having done it is fine.
    const late = restorer.restore();
    for (const row of late) {
      if (row.error !== null) input.say(`could not put back ${row.name}: ${row.error}`);
    }
  }
}
