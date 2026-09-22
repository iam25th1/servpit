// Whether the pit is alive, for anybody who asks.
//
// This is the endpoint that gets pointed at by an uptime check, so it answers
// the three things somebody watching it through a week needs: is the worker
// there, how long since it last did anything, and is it running, resting or
// paused. Nothing else. No balances, no addresses, no pid, no file paths, no
// round it is about to play.
//
// Aliveness is the lock file's heartbeat, which the worker rewrites at the
// top of every interval, rather than the round store, which is quiet by design
// between rounds. A heartbeat older than an interval and a margin means the
// worker is not coming round again, whatever the last round says.

import type { ArenaState } from "./state";

export type WorkerState = "alive" | "stale" | "unknown";
export type PitState = "running" | "resting" | "paused" | "unknown";

export interface Health {
  /** True when the worker is alive and the pit is not stuck. */
  ok: boolean;
  worker: WorkerState;
  pit: PitState;
  /** Seconds since the last round finished, or null when none ever has. */
  sinceLastRoundSeconds: number | null;
  /** Seconds until the next one is due, or null when nothing is scheduled. */
  nextRoundInSeconds: number | null;
  network: string;
}

/** How far past an interval a heartbeat is allowed to be before it is stale. */
export const HEARTBEAT_MARGIN_MS = 5 * 60 * 1000;

const seconds = (ms: number): number => Math.max(0, Math.round(ms / 1000));

/**
 * The health of the pit, from the state file and the lock's heartbeat.
 *
 * heartbeatAt is null when there is no lock file at all, which is a worker
 * that has never run here or one that stopped cleanly and released it. That
 * is reported as unknown rather than dead, because the two look the same from
 * the outside and calling a clean stop a failure would page somebody at
 * three in the morning for a deploy.
 */
export function health(state: ArenaState, heartbeatAt: number | null, intervalMs: number, network: string, now: number): Health {
  const worker: WorkerState = heartbeatAt === null ? "unknown" : now - heartbeatAt <= intervalMs + HEARTBEAT_MARGIN_MS ? "alive" : "stale";

  const phase = state.round?.phase ?? null;
  const pit: PitState = state.paused ? "paused" : phase === null ? "unknown" : phase === "resting" || phase === "failed" ? "resting" : "running";

  const lastAt = state.last ? Date.parse(state.last.phases.at(-1)?.at ?? state.last.startedAt) : NaN;
  const nextAt = state.nextRoundAt === null ? NaN : Date.parse(state.nextRoundAt);

  return {
    // Paused is a healthy pit that an operator stopped on purpose, so it is
    // ok. A worker nobody can find is not.
    ok: worker === "alive" || (worker === "unknown" && state.paused),
    worker,
    pit,
    sinceLastRoundSeconds: Number.isFinite(lastAt) ? seconds(now - lastAt) : null,
    nextRoundInSeconds: Number.isFinite(nextAt) ? seconds(nextAt - now) : null,
    network,
  };
}
