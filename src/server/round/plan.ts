// Planning a round: read every balance from chain, ask each agent to decide,
// and produce the plan the player is shown.
//
// This module decides. The settle path may not import it, which a guard test
// enforces by walking the import graph.

import { NAMED_AGENTS } from "@/config/agents";
import { faceFor, profileFor } from "@/config/replacements";
import { bankEnabled, bankRateBounds, maxLoanStakes, maxStakeMultiple, CREDIT_TERMS } from "@/config/economy";
import { clampStake } from "@/economy/prize";
import { stakeWeiFrom, toChips } from "@/config/stake";
import { toWei } from "../money";
import type { PlannedLoan } from "./types";
import { totalOwed } from "./debt";
import type { Entrant } from "@/engine/resolveRound";
import { decideForAgents } from "../decisions/decide";
import { decideLoan, lendableChips, type BankDecision, type LoanBounds, type LoanRequest } from "../decisions/bank";
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

/**
 * What an agent says when it cannot cover a seat.
 *
 * Fixed, and never a model call. There is nothing to reason about: it either
 * gets the difference from the bank or it is finished, and asking a model to
 * narrate that costs a round trip to be told what we already know.
 */
export const TAPPED_OUT = "I'm tapped out. I need a loan.";

export async function planRound(
  ctx: FlowContext,
  seed: string,
  onDecided?: (decision: AgentDecision) => void,
  onLoan?: (decision: BankDecision, name: string) => void,
): Promise<RoundPlan> {
  if (!SEED.test(seed)) throw new RangeError(`seed must match ${SEED}`);
  // A share of a funded wallet rather than a flat amount, so an agent can
  // actually run low and its reasoning has something to weigh.
  const stakeWei = stakeWeiFrom();
  // One seat price and nothing to borrow with, unless the bank is on. With it
  // off the multiple is one, every seat costs the same, and nothing below
  // behaves any differently than it did before the bank existed.
  const stakeMultiple = bankEnabled() ? maxStakeMultiple() : 1;
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
  for (const seat of NAMED_AGENTS) {
    const wallet = ctx.wallets.agents.get(seat.id);
    if (!wallet) continue;
    // Who is in this seat now. After a wreck the wallet is reused and the
    // occupant is not, so the panel shows somebody new rather than the same
    // six names cycling forever.
    const profile = profileFor(seat.id, ctx.debts.currentIdentity(seat.id));
    // Keyed by the seat, because that is what owns the wallet, the debt and
    // every idempotency key. The name is whoever is sitting in it.
    const base = {
      agentId: seat.id,
      name: profile.name,
      strategy: profile.strategy,
      address: wallet.address,
      face: faceFor(seat.id, ctx.debts.currentIdentity(seat.id)),
      // From the debt store, which carries accrued interest. The ledger only
      // knows what was advanced, and what an agent owes is more than that.
      debtWei: bankEnabled() ? totalOwed(ctx.debts.get(seat.id, ctx.debts.currentIdentity(seat.id))) : undefined,
    };
    const sitOut = (reason: string): void => {
      log.warn("balance unreadable, agent sits this round out", { agentId: seat.id, address: wallet.address, reason: redact(reason) });
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
    snapshots.push({
      profile: { ...profile, id: seat.id },
      address: wallet.address,
      balanceWei,
      stakeWei,
      maxStakeMultiple: stakeMultiple,
      debtWei: totalOwed(ctx.debts.get(seat.id, ctx.debts.currentIdentity(seat.id))),
      recentOutcomes: ctx.store.outcomesFor(profile.id),
    });
  }

  // Reported straight away, and before the round can stop. An agent whose
  // wallet is unreachable has nothing to think about, and leaving it on
  // "thinking" is what the player stared at for the whole of the failure this
  // fixes. Even when every one of them failed, the panel should say so rather
  // than showing six agents still deciding next to an error.
  for (const decision of unreachable) onDecided?.(decision);

  if (snapshots.length === 0) {
    throw new ChainUnreachableError("no agent balance could be read from the chain");
  }

  const context: RoundContext = { roundId, participants: ctx.entrants, poolWei: stakeWei * BigInt(ctx.entrants), stakeWei };
  // An agent that cannot cover a seat has nothing to decide. It is not asked,
  // it says the same plain thing every time, and it goes straight to the bank
  // for what it is short.
  //
  // This closes the gap the 12c simulation left open: a broke agent that
  // never asks is never denied, and an agent that is never denied is never
  // wrecked. Sitting out quietly is not an option the pit offers.
  const bankOn = stakeMultiple > 1 && Boolean(ctx.wallets.bank);
  const tapped = bankOn ? snapshots.filter((s) => s.balanceWei < stakeWei) : [];
  const tappedIds = new Set(tapped.map((s) => s.profile.id));
  const asked = snapshots.filter((s) => !tappedIds.has(s.profile.id));

  const run = await decideForAgents({ client: ctx.serv, meter: ctx.meter }, asked, context, onDecided);

  const tappedDecisions: AgentDecision[] = tapped.map((s) => ({
    agentId: s.profile.id,
    name: s.profile.name,
    strategy: s.profile.strategy,
    address: s.address,
    balanceWei: s.balanceWei,
    decision: { enter: true, stake: toChips(stakeWei), reason: TAPPED_OUT },
    source: "heuristic",
    rejection: "cannot cover a seat, so it asked the bank rather than deciding",
  }));
  for (const d of tappedDecisions) onDecided?.(d);
  run.decisions = [...run.decisions, ...tappedDecisions];

  // Final gate before money moves: the chain, not the model, decides who can
  // enter. Gas is no longer sponsored, so the bar is the stake plus whatever
  // the chain says to keep back; an agent that can cover only the stake would
  // revert part way through the round.
  // What the bank is actually holding, read from the chain. Every bound on
  // what it lends is measured against this and never against anything a model
  // said about it.
  let treasuryWei = ctx.wallets.bank && stakeMultiple > 1 ? await ctx.bankroll.get(ctx.wallets.bank) : 0n;
  const rates = bankRateBounds();
  const loans: PlannedLoan[] = [];
  const refusals: Array<{ agentId: string; name: string; reason: string; askedWei: bigint; tappedOut: boolean }> = [];
  const borrowed = new Map<string, { principalWei: bigint; rateBps: number }>();
  // Agents that could not cover a seat and were turned down. They are out,
  // and the settle path is what ends them.
  const deniedCredit: string[] = [];

  const decisions: AgentDecision[] = [...unreachable];
  const entering: EnteringAgent[] = [];
  for (const decision of run.decisions) {
    const snapshot = snapshots.find((s) => s.profile.id === decision.agentId)!;
    // What this agent actually puts up. Clamped here as well as in the
    // validator, because the number that moves money is derived once, from
    // the round's own stake, and never taken on trust from an answer.
    const chosenWei = stakeMultiple > 1 && !tappedIds.has(decision.agentId) ? clampStake(stakeWei, stakeMultiple, toWei(decision.decision.stake)) : stakeWei;

    // The shortfall is arithmetic on figures read from the chain. The agent
    // never states a loan amount and is never asked for one.
    let lentWei = 0n;
    if (decision.decision.enter && stakeMultiple > 1 && ctx.wallets.bank) {
      const ownWei = snapshot.balanceWei > ctx.chain.gasReserveWei ? snapshot.balanceWei - ctx.chain.gasReserveWei : 0n;
      const shortfallWei = chosenWei > ownWei ? chosenWei - ownWei : 0n;
      if (shortfallWei > 0n) {
        const bounds: LoanBounds = {
          treasuryChips: toChips(treasuryWei),
          maxLoanChips: toChips(maxLoanStakes() * stakeWei),
          debtCeilingChips: toChips(CREDIT_TERMS.debtCeilingStakes * stakeWei),
          minRateBps: rates.minBps,
          maxRateBps: rates.maxBps,
        };
        const request: LoanRequest = {
          record: {
            agentId: snapshot.profile.id,
            name: snapshot.profile.name,
            balanceChips: toChips(snapshot.balanceWei),
            debtChips: toChips(snapshot.debtWei ?? 0n),
            roundsPlayed: snapshot.recentOutcomes.length,
            wins: snapshot.recentOutcomes.filter((o) => o.entered && o.netWei > 0n).length,
            repaidChips: 0,
          },
          stakeChips: toChips(chosenWei),
          shortfallChips: toChips(shortfallWei),
        };
        // A loan that would breach the debt ceiling on its own, or that the
        // treasury cannot cover, is already zero here and the bank is not
        // asked to pretend otherwise.
        const tappedOutHere = tappedIds.has(snapshot.profile.id);
        if (lendableChips(request, bounds) <= 0) {
          refusals.push({ agentId: snapshot.profile.id, name: snapshot.profile.name, reason: "Nothing left to lend against that record.", askedWei: shortfallWei, tappedOut: tappedOutHere });
          if (tappedIds.has(snapshot.profile.id)) deniedCredit.push(snapshot.profile.id);
        } else {
          const answer = await decideLoan({ client: ctx.serv, meter: ctx.meter }, request, bounds);
          onLoan?.(answer, snapshot.profile.name);
          if (answer.decision.approve && answer.decision.amountChips > 0) {
            lentWei = toWei(answer.decision.amountChips);
            treasuryWei -= lentWei;
            borrowed.set(snapshot.profile.id, { principalWei: lentWei, rateBps: answer.decision.rateBps });
            loans.push({
              agentId: snapshot.profile.id,
              name: snapshot.profile.name,
              address: snapshot.address,
              askedWei: shortfallWei,
              tappedOut: tappedOutHere,
              principalWei: lentWei,
              rateBps: answer.decision.rateBps,
              reason: answer.decision.reason,
              source: answer.source,
              rejection: answer.rejection,
              model: answer.model,
              latencyMs: answer.latencyMs,
            });
          } else {
            refusals.push({ agentId: snapshot.profile.id, name: snapshot.profile.name, reason: answer.decision.reason, askedWei: shortfallWei, tappedOut: tappedOutHere });
            if (tappedIds.has(snapshot.profile.id)) deniedCredit.push(snapshot.profile.id);
          }
        }
      }
    }

    // An agent enters at its balance plus whatever was approved, if that
    // reaches a seat. Otherwise it sits out. There is no second call.
    const fundedWei = snapshot.balanceWei + lentWei;
    const required = chosenWei + ctx.chain.gasReserveWei;
    const affordable = fundedWei >= required ? chosenWei : clampStake(stakeWei, stakeMultiple, fundedWei > ctx.chain.gasReserveWei ? fundedWei - ctx.chain.gasReserveWei : 0n);
    const finalWei = stakeMultiple > 1 ? affordable : chosenWei;
    if (decision.decision.enter && fundedWei < finalWei + ctx.chain.gasReserveWei) {
      // Plain words and chips: this line is shown to the player, not only
      // logged. "short on gas" and "short on stake" stay as the two cases so
      // an operator can still tell them apart at a glance.
      const shortfall = ctx.chain.gasReserveWei > 0n && fundedWei >= finalWei ? "gas" : "stake";
      const held = toChips(fundedWei);
      const seat = toChips(finalWei);
      const reason =
        shortfall === "gas"
          ? `has ${held} chips but not enough left over for fees, so it is short on gas`
          : `has ${held} chips, and a seat costs ${seat}, so it is short on stake`;
      log.warn("entry blocked by on chain balance", { agentId: decision.agentId, reason });
      decisions.push({ ...decision, decision: { enter: false, stake: 0, reason: `excluded: ${reason}` }, rejection: decision.rejection ? `${decision.rejection}; ${reason}` : reason });
      continue;
    }
    decisions.push(decision);
    if (decision.decision.enter) {
      const loan = borrowed.get(decision.agentId);
      entering.push({ agentId: decision.agentId, entrantId: `agent-${decision.agentId}`, stakeWei: finalWei, ...(loan ? { loanWei: loan.principalWei, rateBps: loan.rateBps } : {}) });
    }
  }

  const botCount = Math.max(0, ctx.entrants - entering.length);
  const bots = Array.from({ length: botCount }, (_, i) => `bot-${String(i).padStart(2, "0")}`);
  const entrants: Entrant[] = [...entering.map((e) => ({ id: e.entrantId })), ...bots.map((id) => ({ id }))];

  // The lender's books as this round starts, for the panel. Read rather than
  // recomputed: the treasury is the figure every loan was bounded against,
  // and the debts are the ones interest will be charged on.
  const bank = bankOn
    ? {
        treasuryWei,
        book: snapshots
          .map((s) => ({ snapshot: s, debt: ctx.debts.get(s.profile.id, ctx.debts.currentIdentity(s.profile.id)) }))
          .filter(({ debt }) => debt.principalWei + debt.interestWei > 0n)
          .map(({ snapshot, debt }) => ({
            agentId: snapshot.profile.id,
            name: snapshot.profile.name,
            principalWei: debt.principalWei,
            interestWei: debt.interestWei,
            rateBps: debt.rateBps,
          })),
      }
    : null;

  // Roster order, not the order they happened to resolve in. The entrant list
  // above is built from entering, which never contains an unreachable agent.
  const order = new Map(NAMED_AGENTS.map((p, i) => [p.id, i]));
  decisions.sort((a, b) => (order.get(a.agentId) ?? 0) - (order.get(b.agentId) ?? 0));

  return { roundId, seed, stakeWei, decisions, snapshots, entering, bots, entrants, servCalls: run.servCalls + loans.length + refusals.length, guardRefusals: run.guardRefusals, rejections: run.rejections, loans, refusals, deniedCredit, bank };
}

/** Told as each entry confirms on chain, so a caller can show it landing. */