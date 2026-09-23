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
import { servReasoningOn } from "../serv/switch";
import { decideLoan, lendableChips, type BankDecision, type LoanBounds, type LoanRequest } from "../decisions/bank";
import type { AgentDecision, AgentSnapshot, RoundContext } from "../decisions/types";
import { ChainUnreachableError } from "../errors";
import { log, redact } from "../log";
import type { BankSnapshot, EnteringAgent, FlowContext, RoundPlan } from "./types";
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

/**
 * Who is sitting in each seat, before anybody has decided anything.
 *
 * The lineup draws a row per seat from the moment a round starts, and until
 * this it drew them from the roster: a seat whose original was carried out
 * showed the dead agent's name for as long as the panel was waiting. Cheap
 * enough to send first, because it reads the debt store and nothing else.
 */
export function seatOccupants(ctx: FlowContext): Array<{ agentId: string; name: string; face: string | null }> {
  return NAMED_AGENTS.map((seat) => {
    const identityId = ctx.debts.currentIdentity(seat.id);
    const occupantId = ctx.debts.occupantOf(seat.id);
    return { agentId: seat.id, name: profileFor(seat.id, identityId, occupantId).name, face: faceFor(seat.id, identityId, occupantId) };
  });
}

/** What the caller knows about this round that the plan cannot work out. */
export interface PlanOptions {
  /**
   * Whether this round may reason at all, before the operator switch is
   * consulted.
   *
   * The lever and the tests leave it out, which means yes, exactly as it has
   * always been. The arena worker passes false for a round the interval
   * started unless an operator has turned scheduled reasoning on, and true
   * for a round somebody pulled.
   */
  reasoning?: boolean;
}

export async function planRound(
  ctx: FlowContext,
  seed: string,
  onDecided?: (decision: AgentDecision) => void,
  onLoan?: (decision: BankDecision, name: string, bank: BankSnapshot) => void,
  options: PlanOptions = {},
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
  // Once per round, for the agents and for the lender together, so a switch
  // flipped between the two cannot produce a round that is half reasoned.
  // Undefined rather than the client is the whole mechanism: decideForAgent
  // and decideLoan already answer deterministically when there is nobody to
  // ask, which is the same path a pit with no key has always taken.
  // Two gates, in this order: what this round is for, then what the operator
  // allows. A pulled round asks to reason and a scheduled one does not, but
  // neither reaches the model with the switch off.
  const serv = options.reasoning !== false && servReasoningOn(ctx.servSwitchFile) ? ctx.serv : undefined;

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
  // Who is in each seat and what it owes, decided once and stamped onto every
  // decision at the end. The decisions the player sees are built in two other
  // places, the model layer and the tapped out list, and neither of them can
  // see a debt store.
  const seats = new Map<string, { face: string | null; debtWei?: bigint }>();
  for (const seat of NAMED_AGENTS) {
    const wallet = ctx.wallets.agents.get(seat.id);
    if (!wallet) continue;
    // Who is in this seat now. After a wreck the wallet is reused and the
    // occupant is not, so the panel shows somebody new rather than the same
    // six names cycling forever.
    const identityId = ctx.debts.currentIdentity(seat.id);
    const occupantId = ctx.debts.occupantOf(seat.id);
    const profile = profileFor(seat.id, identityId, occupantId);
    // Keyed by the seat, because that is what owns the wallet, the debt and
    // every idempotency key. The name is whoever is sitting in it.
    const base = {
      agentId: seat.id,
      name: profile.name,
      strategy: profile.strategy,
      address: wallet.address,
      face: faceFor(seat.id, identityId, occupantId),
      // From the debt store, which carries accrued interest. The ledger only
      // knows what was advanced, and what an agent owes is more than that.
      debtWei: bankEnabled() ? totalOwed(ctx.debts.get(seat.id, identityId)) : undefined,
    };
    seats.set(seat.id, { face: base.face, debtWei: base.debtWei });
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
      debtWei: totalOwed(ctx.debts.get(seat.id, identityId)),
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

  // The record, for the rounds that are not reasoning. Read here rather than
  // inside the loop so every agent in one round learns from the same history,
  // and passed rather than reached for so a context without a store keeps the
  // fixed rule.
  const run = await decideForAgents({ client: serv, meter: ctx.meter, history: serv ? undefined : ctx.store.all() }, asked, context, onDecided);

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
  // Stamped here rather than at each source, so there is one place that
  // decides what a decision carries about its seat.
  const seated = (d: AgentDecision): AgentDecision => ({ ...d, ...(seats.get(d.agentId) ?? { face: null }) });
  for (const d of tappedDecisions) onDecided?.(seated(d));
  run.decisions = [...run.decisions, ...tappedDecisions].map(seated);

  // Final gate before money moves: the chain, not the model, decides who can
  // enter. Gas is no longer sponsored, so the bar is the stake plus whatever
  // the chain says to keep back; an agent that can cover only the stake would
  // revert part way through the round.
  // What the bank is actually holding, read from the chain. Every bound on
  // what it lends is measured against this and never against anything a model
  // said about it.
  let treasuryWei = ctx.wallets.bank && stakeMultiple > 1 ? await ctx.bankroll.get(ctx.wallets.bank) : 0n;
  // Who owes what, read rather than recomputed, as of whenever it is asked.
  // Called with each answer and again when the plan is done, so the panel
  // says the same thing during the banking phase as it does after it.
  const bookNow = (): BankSnapshot["book"] =>
    snapshots
      .map((s) => ({ snapshot: s, debt: ctx.debts.get(s.profile.id, ctx.debts.currentIdentity(s.profile.id)) }))
      .filter(({ debt }) => debt.principalWei + debt.interestWei > 0n)
      .map(({ snapshot, debt }) => ({
        agentId: snapshot.profile.id,
        name: snapshot.profile.name,
        principalWei: debt.principalWei,
        interestWei: debt.interestWei,
        rateBps: debt.rateBps,
      }));
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
      const identityId = ctx.debts.currentIdentity(snapshot.profile.id);
      const held = ctx.debts.get(snapshot.profile.id, identityId);
      const history = ctx.store.historyFor(snapshot.profile.id, held.bornAtRound, toChips(stakeWei));
      // What it cannot cover itself: the stake plus the gas it has to keep
      // back, against what it actually holds.
      //
      // This used to subtract the reserve from the balance and clamp that at
      // zero, which is the same number while an agent holds more than the
      // reserve and too small a number once it does not. An agent with less
      // than the reserve asked for exactly the stake, was lent exactly the
      // stake, and was then turned away for gas: on Base Sepolia, where the
      // reserve is two seats, four of the six agents spent the evening in
      // that state, and a wrecked seat could never be refilled by a loan
      // however willing the lender was.
      const neededWei = chosenWei + ctx.chain.gasReserveWei;
      const shortfallWei = neededWei > snapshot.balanceWei ? neededWei - snapshot.balanceWei : 0n;
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
            // The whole record of whoever is in the seat, not the last five
            // rounds of it. A win that scrolled out of a five round window
            // used to make a proven agent read as unproven, and the lender
            // judges on exactly this.
            roundsPlayed: history.roundsEntered,
            wins: history.wins,
            // What this occupant has actually handed back. It was a zero
            // here, so the lender judged an agent that had repaid everything
            // exactly as it judged one that had never paid back a chip.
            repaidChips: toChips(held.repaidWei),
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
          const answer = await decideLoan({ client: serv, meter: ctx.meter }, request, bounds);
          // With the answer, what the lender is holding as it gives it. The
          // panel is drawn from this, and without it a viewer watching the
          // banking phase sees the answers with nobody giving them.
          onLoan?.(answer, snapshot.profile.name, { treasuryWei, book: bookNow() });
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
      // A loan approved for a seat this agent is not going to take is a loan
      // that should never leave the bank. It happens when the approval was
      // capped, by the ceiling or by what the treasury can spare, so the
      // agent ends up short anyway: the chips would go out, the debt would be
      // recorded, and the round they were borrowed for would happen without
      // the borrower. The bank keeps them.
      if (lentWei > 0n) {
        const index = loans.findIndex((l) => l.agentId === decision.agentId);
        if (index >= 0) loans.splice(index, 1);
        borrowed.delete(decision.agentId);
        treasuryWei += lentWei;
        log.warn("loan withdrawn, the borrower is not entering", { agentId: decision.agentId, principalWei: lentWei.toString(), reason });
      }
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
  const bank = bankOn ? { treasuryWei, book: bookNow() } : null;

  // Roster order, not the order they happened to resolve in. The entrant list
  // above is built from entering, which never contains an unreachable agent.
  const order = new Map(NAMED_AGENTS.map((p, i) => [p.id, i]));
  decisions.sort((a, b) => (order.get(a.agentId) ?? 0) - (order.get(b.agentId) ?? 0));

  return { roundId, seed, stakeWei, decisions, snapshots, entering, bots, entrants, servCalls: run.servCalls + loans.length + refusals.length, guardRefusals: run.guardRefusals, rejections: run.rejections, loans, refusals, deniedCredit, bank };
}

/** Told as each entry confirms on chain, so a caller can show it landing. */