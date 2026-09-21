// Planning a round: read every balance from chain, ask each agent to decide,
// and produce the plan the player is shown.
//
// This module decides. The settle path may not import it, which a guard test
// enforces by walking the import graph.

import { NAMED_AGENTS } from "@/config/agents";
import { stakeWeiFrom, toChips } from "@/config/stake";
import type { Entrant } from "@/engine/resolveRound";
import { decideForAgents } from "../decisions/decide";
import type { AgentDecision, AgentSnapshot, RoundContext } from "../decisions/types";
import { log } from "../log";
import type { EnteringAgent, FlowContext, RoundPlan } from "./types";
import { roundIdFor } from "./types";

/** Seeds are opaque to the engine, so the shape is checked here. */
const SEED = /^[A-Za-z0-9_-]{1,64}$/;

export async function planRound(ctx: FlowContext, seed: string, onDecided?: (decision: AgentDecision) => void): Promise<RoundPlan> {
  if (!SEED.test(seed)) throw new RangeError(`seed must match ${SEED}`);
  // A share of a funded wallet rather than a flat amount, so an agent can
  // actually run low and its reasoning has something to weigh.
  const stakeWei = stakeWeiFrom();
  const roundId = roundIdFor(seed, ctx.entrants);

  ctx.bankroll.invalidate();
  const snapshots: AgentSnapshot[] = [];
  for (const profile of NAMED_AGENTS) {
    const wallet = ctx.wallets.agents.get(profile.id);
    if (!wallet) continue;
    snapshots.push({
      profile,
      address: wallet.address,
      balanceWei: await ctx.bankroll.get(wallet),
      stakeWei,
      recentOutcomes: ctx.store.outcomesFor(profile.id),
    });
  }

  const context: RoundContext = { roundId, participants: ctx.entrants, poolWei: stakeWei * BigInt(ctx.entrants), stakeWei };
  const run = await decideForAgents({ client: ctx.serv, meter: ctx.meter }, snapshots, context, onDecided);

  // Final gate before money moves: the chain, not the model, decides who can
  // enter. Gas is no longer sponsored, so the bar is the stake plus whatever
  // the chain says to keep back; an agent that can cover only the stake would
  // revert part way through the round.
  const required = stakeWei + ctx.chain.gasReserveWei;
  const decisions: AgentDecision[] = [];
  const entering: EnteringAgent[] = [];
  for (const decision of run.decisions) {
    const snapshot = snapshots.find((s) => s.profile.id === decision.agentId)!;
    if (decision.decision.enter && snapshot.balanceWei < required) {
      // Plain words and chips: this line is shown to the player, not only
      // logged. "short on gas" and "short on stake" stay as the two cases so
      // an operator can still tell them apart at a glance.
      const shortfall = ctx.chain.gasReserveWei > 0n && snapshot.balanceWei >= stakeWei ? "gas" : "stake";
      const held = toChips(snapshot.balanceWei);
      const seat = toChips(stakeWei);
      const reason =
        shortfall === "gas"
          ? `has ${held} chips but not enough left over for fees, so it is short on gas`
          : `has ${held} chips, and a seat costs ${seat}, so it is short on stake`;
      log.warn("entry blocked by on chain balance", { agentId: decision.agentId, reason });
      decisions.push({ ...decision, decision: { enter: false, stake: 0, reason: `excluded: ${reason}` }, rejection: decision.rejection ? `${decision.rejection}; ${reason}` : reason });
      continue;
    }
    decisions.push(decision);
    if (decision.decision.enter) entering.push({ agentId: decision.agentId, entrantId: `agent-${decision.agentId}`, stakeWei });
  }

  const botCount = Math.max(0, ctx.entrants - entering.length);
  const bots = Array.from({ length: botCount }, (_, i) => `bot-${String(i).padStart(2, "0")}`);
  const entrants: Entrant[] = [...entering.map((e) => ({ id: e.entrantId })), ...bots.map((id) => ({ id }))];

  return { roundId, seed, stakeWei, decisions, snapshots, entering, bots, entrants, servCalls: run.servCalls, guardRefusals: run.guardRefusals, rejections: run.rejections };
}

/** Told as each entry confirms on chain, so a caller can show it landing. */