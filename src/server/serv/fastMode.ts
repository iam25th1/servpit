// Everything a fast run touches outside a round, and how it puts it back.
//
// Three files: the pause file, so the worker is not playing while this is; the
// daily reasoning budget, so the run is not cut off by a gate meant for an
// unattended pit; and the scheduled switch, which is what tells a round it may
// reason. Nothing else in the data directory is written here. The rounds
// themselves write what any round writes, by the ordinary path.
//
// The order matters. Pause first and wait for the round in flight to settle,
// because two writers on six wallets is how a nonce gets used twice. Then
// raise the budget and turn the switch on, which are both cheap to undo. Undo
// everything on the way out, whether the run finished, failed or was
// interrupted, and leave the pause file alone if the operator had already
// paused the pit: this run did not pause it and does not get to resume it.

import { copyFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PAUSE_FILE } from "@/config/arena";
import { pullSettingsFile } from "@/config/pulls";
import { SERV_SCHEDULED_FILE } from "@/config/serv";
import { readPullSettings, writePullSettings } from "@/server/pulls/settings";
import { scheduledReasoningOn, setScheduledReasoning } from "./switch";
import { Restorer, budgetCentsFor, runFast, type FastDeps, type FastResult } from "./fastRun";

/** How long to wait for a round already in flight to finish settling. */
export const PAUSE_WAIT_MS = 6 * 60_000;

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
    // interval, so a round that was already running finishes first.
    const until = (input.now ?? Date.now)() + (input.pauseWaitMs ?? PAUSE_WAIT_MS);
    for (;;) {
      const state = input.arenaState();
      const quiet = state.paused || state.phase === null || state.phase === "resting";
      if (quiet) break;
      if ((input.now ?? Date.now)() >= until) {
        waitTimedOut = true;
        input.say("the round in flight has not settled after the wait. Stopping rather than playing beside it.");
        break;
      }
      input.say(`waiting: the pit is in the ${state.phase} phase.`);
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
