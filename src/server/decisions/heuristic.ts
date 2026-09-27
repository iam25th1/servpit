// The deterministic fallback, and the strategy every unnamed bot uses.
//
// Its own module because the settle path needs it and may not import
// anything that can reach a model. No SERV call, no network, pure given the
// round id and the profile.

import { createHash } from "node:crypto";
import { toChips } from "@/config/stake";
import type { AgentSnapshot, Decision, RoundContext } from "./types";

/** Deterministic fallback and the strategy for unnamed bots. No SERV call. */
export function heuristicDecision(snapshot: AgentSnapshot, round: RoundContext): Decision {
  const p = snapshot.profile;
  // Chips, like every other decision. It used to return wei here, which is
  // the same field the SERV path fills with chips and the same field the
  // panel shows the player, so a fallback decision read as a fourteen digit
  // stake on screen. It was never the number that moved, because the round's
  // own stake is what settles, which is why it survived this long.
  const stake = toChips(snapshot.stakeWei);
  // Said in the agent's own voice, like a reasoned answer, because this line
  // goes in the same speech box. The label beside it is what says it came
  // from the fixed rule rather than a model, so the words do not have to.
  if (snapshot.balanceWei < snapshot.stakeWei * BigInt(p.minBankrollMultiple)) {
    return { enter: false, stake: 0, reason: `Only ${toChips(snapshot.balanceWei)} chips, under the ${p.minBankrollMultiple} seat cushion I keep. Holding.` };
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
      ? `Gut says go. I take about ${chance} in 100 rounds like this one.`
      : `Gut says hold. I only take about ${chance} in 100 rounds like this one.`,
  };
}

