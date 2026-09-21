// The deterministic fallback, and the strategy every unnamed bot uses.
//
// Its own module because the settle path needs it and may not import
// anything that can reach a model. No SERV call, no network, pure given the
// round id and the profile.

import { createHash } from "node:crypto";
import type { AgentSnapshot, Decision, RoundContext } from "./types";

/** Deterministic fallback and the strategy for unnamed bots. No SERV call. */
export function heuristicDecision(snapshot: AgentSnapshot, round: RoundContext): Decision {
  const p = snapshot.profile;
  const stake = Number(snapshot.stakeWei);
  if (snapshot.balanceWei < snapshot.stakeWei * BigInt(p.minBankrollMultiple)) {
    return { enter: false, stake: 0, reason: `heuristic: balance ${snapshot.balanceWei} is below the ${p.minBankrollMultiple}x allocation floor this posture keeps` };
  }
  const last = snapshot.recentOutcomes[snapshot.recentOutcomes.length - 1];
  let chance = p.baseEnterChance;
  if (last?.entered) chance += last.netWei > 0n ? p.afterWinShift : p.afterLossShift;
  if (p.strategy === "opportunist") chance += round.participants >= 24 ? 15 : -15;
  chance = Math.max(0, Math.min(100, chance));

  const digest = createHash("sha256").update(`heuristic/${round.roundId}/${p.id}`).digest();
  const roll = digest.readUInt16BE(0) % 100;
  const enter = roll < chance;
  return {
    enter,
    stake: enter ? stake : 0,
    reason: enter
      ? `heuristic: ${p.strategy} posture commits at ${chance} percent with ${round.participants} participants`
      : `heuristic: ${p.strategy} posture holds at ${chance} percent this period`,
  };
}

