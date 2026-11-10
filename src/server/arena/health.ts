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

import { formatEther } from "viem";
import type { ArenaFunds, ArenaHoldKind, ArenaState, ArenaWalletFunds } from "./state";

export type WorkerState = "alive" | "stale" | "unknown";
export type PitState = "running" | "resting" | "paused" | "unknown";

/** One wallet as the status route reports it: chips, ETH, and what it is short. */
export interface WalletStatus {
  chips: number;
  eth: string;
  neededChips: number;
  neededEth: string;
  /** What has to be sent to it before the pit will play again. Zero when nothing. */
  toResumeChips: number;
  toResumeEth: string;
  ok: boolean;
}

export interface FundsStatus {
  /** When the worker last read the wallets. The route itself reads nothing. */
  checkedAt: string;
  ok: boolean;
  pot: WalletStatus;
  /** Null when this pit does not lend, so the bank is never asked for anything. */
  bank: WalletStatus | null;
  /** Null when this pit does not lend, or has no operator wallet. */
  operator: WalletStatus | null;
  retirements: { lastHour: number; cap: number } | null;
}

export interface Health {
  /**
   * True when the worker is alive and the pit is not stuck. A pit holding for
   * money is not stuck: it is waiting, on purpose, and says why below.
   */
  ok: boolean;
  worker: WorkerState;
  pit: PitState;
  /**
   * Why a paused pit is paused. "operator" is the pause file; "funds" and
   * "retirements" are the pit holding itself. Null while it is not paused.
   */
  pausedFor: "operator" | ArenaHoldKind | null;
  /** The sentence the site shows while the pit holds itself, or null. */
  reason: string | null;
  /** When a holding pit looks at its wallets again, or null. */
  nextCheckAt: string | null;
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
  const hold = state.hold ?? null;
  const pit: PitState = state.paused || hold ? "paused" : phase === null ? "unknown" : phase === "resting" || phase === "failed" ? "resting" : "running";

  const lastAt = state.last ? Date.parse(state.last.phases.at(-1)?.at ?? state.last.startedAt) : NaN;
  const nextAt = state.nextRoundAt === null ? NaN : Date.parse(state.nextRoundAt);

  return {
    // Paused is a healthy pit that an operator stopped on purpose, so it is
    // ok. A worker nobody can find is not.
    ok: worker === "alive" || (worker === "unknown" && state.paused),
    worker,
    pit,
    pausedFor: state.paused ? "operator" : (hold?.kind ?? null),
    reason: hold?.reason ?? null,
    nextCheckAt: hold?.nextCheckAt ?? null,
    sinceLastRoundSeconds: Number.isFinite(lastAt) ? seconds(now - lastAt) : null,
    nextRoundInSeconds: Number.isFinite(nextAt) ? seconds(nextAt - now) : null,
    network,
  };
}

function walletStatus(w: ArenaWalletFunds): WalletStatus {
  return {
    chips: w.chips,
    eth: formatEther(BigInt(w.wei)),
    neededChips: w.neededChips,
    neededEth: formatEther(BigInt(w.neededWei)),
    toResumeChips: w.shortChips,
    toResumeEth: formatEther(BigInt(w.shortWei)),
    ok: w.ok,
  };
}

/** The worker's last check, as the route reports it. Balances only, never an address. */
export function fundsStatus(funds: ArenaFunds | null): FundsStatus | null {
  if (funds === null) return null;
  return {
    checkedAt: funds.checkedAt,
    ok: funds.ok,
    pot: walletStatus(funds.pot),
    bank: funds.bank ? walletStatus(funds.bank) : null,
    operator: funds.operator ? walletStatus(funds.operator) : null,
    retirements: funds.retirements ?? null,
  };
}

/** Health, and what the wallets held at the worker's last look. For /api/status. */
export interface PitStatus extends Health {
  funds: FundsStatus | null;
}

/**
 * Everything health says, and the balances behind a hold.
 *
 * Its own route rather than more of /api/health, which an uptime check polls
 * and which says nothing about money on purpose. Still no address, key or
 * hash: chips and ETH, what a round needs, and what to send to resume.
 */
export function pitStatus(state: ArenaState, heartbeatAt: number | null, intervalMs: number, network: string, now: number): PitStatus {
  return { ...health(state, heartbeatAt, intervalMs, network, now), funds: fundsStatus(state.funds ?? null) };
}
