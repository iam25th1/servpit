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
import { ChainUnreachableError } from "../errors";
import { log, redact } from "../log";
import type { EnteringAgent, FlowContext, RoundPlan } from "./types";
import { roundIdFor } from "./types";

/** Seeds are opaque to the engine, so the shape is checked here. */
const SEED = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Shown to the player when an agent's wallet could not be read.
 *
 * Plain words, because this line goes on screen next to the agent's name. The
 * technical detail goes to the log, where it belongs.
 */
export const UNREACHABLE_REASON = "Couldn't reach its wallet, sitting this one out";

export async function planRound(ctx: FlowContext, seed: string, onDecided?: (decision: AgentDecision) => void): Promise<RoundPlan> {
  if (!SEED.test(seed)) throw new RangeError(`seed must match ${SEED}`);
  // A share of a funded wallet rather than a flat amount, so an agent can
  // actually run low and its reasoning has something to weigh.
  const stakeWei = stakeWeiFrom();
  const roundId = roundIdFor(seed, ctx.entrants);

  ctx.bankroll.invalidate();
  // Every balance in one chain request. It used to be one request per agent,
  // sent one after another, which is six chances for a public endpoint to
  // time out and take the whole decision phase with it.
  const open = NAMED_AGENTS.map((profile) => ctx.wallets.agents.get(profile.id)).filter((w) => w !== undefined);
  let unread: string[];
  try {
    unread = await ctx.bankroll.warm(ctx.chain, open);
  } catch (e) {
    // The read already walked every endpoint, twice. There is nothing left to
    // try and nothing to decide on, so the round stops here rather than
    // asking six agents to reason about balances nobody could read.
    log.error("every endpoint failed the balance read", { reason: redact(e instanceof Error ? e.message : String(e)) });
    throw new ChainUnreachableError("no agent balance could be read from the chain", e);
  }

  // One agent losing its wallet costs that agent its round. It must never
  // cost the other five theirs, and it must never let this one in on a
  // balance that was never verified.
  const snapshots: AgentSnapshot[] = [];
  const unreachable: AgentDecision[] = [];
  for (const profile of NAMED_AGENTS) {
    const wallet = ctx.wallets.agents.get(profile.id);
    if (!wallet) continue;
    const base = { agentId: profile.id, name: profile.name, strategy: profile.strategy, address: wallet.address };
    const sitOut = (reason: string): void => {
      log.warn("balance unreadable, agent sits this round out", { agentId: profile.id, address: wallet.address, reason: redact(reason) });
      unreachable.push({ ...base, balanceWei: 0n, decision: { enter: false, stake: 0, reason: UNREACHABLE_REASON }, source: "heuristic", rejection: UNREACHABLE_REASON });
    };
    if (unread.includes(wallet.address)) {
      sitOut("the chain did not answer for this address");
      continue;
    }
    let balanceWei: bigint;
    try {
      balanceWei = await ctx.bankroll.get(wallet);
    } catch (e) {
      sitOut(e instanceof Error ? e.message : String(e));
      continue;
    }
    snapshots.push({ profile, address: wallet.address, balanceWei, stakeWei, recentOutcomes: ctx.store.outcomesFor(profile.id) });
  }

  if (snapshots.length === 0) {
    throw new ChainUnreachableError("no agent balance could be read from the chain");
  }
  // Reported straight away. An agent whose wallet is unreachable has nothing
  // to think about, and leaving it on "thinking" is what the player saw for
  // the whole of the failure this fixes.
  for (const decision of unreachable) onDecided?.(decision);

  const context: RoundContext = { roundId, participants: ctx.entrants, poolWei: stakeWei * BigInt(ctx.entrants), stakeWei };
  const run = await decideForAgents({ client: ctx.serv, meter: ctx.meter }, snapshots, context, onDecided);

  // Final gate before money moves: the chain, not the model, decides who can
  // enter. Gas is no longer sponsored, so the bar is the stake plus whatever
  // the chain says to keep back; an agent that can cover only the stake would
  // revert part way through the round.
  const required = stakeWei + ctx.chain.gasReserveWei;
  const decisions: AgentDecision[] = [...unreachable];
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

  // Roster order, not the order they happened to resolve in. The entrant list
  // above is built from entering, which never contains an unreachable agent.
  const order = new Map(NAMED_AGENTS.map((p, i) => [p.id, i]));
  decisions.sort((a, b) => (order.get(a.agentId) ?? 0) - (order.get(b.agentId) ?? 0));

  return { roundId, seed, stakeWei, decisions, snapshots, entering, bots, entrants, servCalls: run.servCalls, guardRefusals: run.guardRefusals, rejections: run.rejections };
}

/** Told as each entry confirms on chain, so a caller can show it landing. */