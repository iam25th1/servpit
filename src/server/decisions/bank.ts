// Marrow, the lender.
//
// The bank is an agent like the other six: it is asked, it answers in JSON,
// and nothing it says about money is believed. It decides one request at a
// time, given the borrower's record in chips, and every bound on what it
// approves is checked here against figures this process read from the chain.
//
// Its own module because the settle path may not reach anything that can
// call a model, and the import graph walk covers this file.
//
// SERV's schema validator rejects numeric range keywords, so nothing below
// expresses a bound in the schema. The bounds live in validateLoanDecision,
// which is where they would have to live anyway: a model that states its own
// limits is not a limit.

import { log } from "../log";
import type { CostMeter, ServClient } from "../serv/client";
import { plainPunctuation, reasonFault } from "./decide";
import type { DecisionSource } from "./types";

/** What the lender is called, and how it talks. */
export const BANK_NAME = "Marrow";

export const BANK_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["approve", "amount", "rateBps", "reason"],
  properties: {
    approve: { type: "boolean", description: "true to lend" },
    amount: { type: "integer", description: "chips to lend, never more than the shortfall, and exactly 0 when refusing" },
    rateBps: { type: "integer", description: "interest per round in basis points, inside the stated range" },
    reason: { type: "string", description: "one short sentence in the lender's own voice" },
  },
} as const;

/** Everything the bank is told about a borrower. Chips throughout. */
export interface BorrowerRecord {
  agentId: string;
  name: string;
  balanceChips: number;
  debtChips: number;
  roundsPlayed: number;
  wins: number;
  /** Chips this borrower has paid back across every loan so far. */
  repaidChips: number;
}

export interface LoanRequest {
  record: BorrowerRecord;
  /** What the agent wants to put up. */
  stakeChips: number;
  /** What it cannot cover itself, which is the most that can be lent. */
  shortfallChips: number;
}

/** Bounds the bank is held to, none of which come from the model. */
export interface LoanBounds {
  /** The bank's real balance, read from the chain. */
  treasuryChips: number;
  /** Most one advance may be. */
  maxLoanChips: number;
  /** Total debt above this wrecks an agent, so a loan may not reach it. */
  debtCeilingChips: number;
  minRateBps: number;
  maxRateBps: number;
}

export interface LoanDecision {
  approve: boolean;
  amountChips: number;
  rateBps: number;
  reason: string;
}

export interface BankDecision {
  agentId: string;
  decision: LoanDecision;
  source: DecisionSource;
  /** Why the model's answer was not used, when it was not. */
  rejection?: string;
  model?: string;
  latencyMs?: number;
}

const MAX_REASON = 400;

/**
 * What the lender gets to think for, per attempt and in total.
 *
 * Longer than an agent's, and deliberately not the same setting: the agent
 * budget is what stops one slow operator holding up the other five, and six
 * of those run at once. The bank asks one question at a time.
 */
export const BANK_TIMEOUT_MS = 40_000;
export const BANK_DEADLINE_MS = 90_000;

/**
 * Room for the lender to answer in.
 *
 * Not the size of the answer, which is a sentence and three numbers, but the
 * size of the budget the model needs to produce one. At four hundred the
 * gateway returned empty content with finish_reason stop, twice in a row on
 * one borrower's record and three times in a row during a live round, and
 * every one of those loans went out with the deterministic lender's words on
 * it. The same prompt answered twice at eight hundred.
 *
 * It costs nothing extra to allow: SERV bills what it emits. What it does
 * raise is the estimated maximum cost SERV checks a balance against, so this
 * is the first thing that will refuse on an account down to its last cents.
 */
export const BANK_MAX_COMPLETION_TOKENS = 800;

const BANK_SYSTEM = [
  `You are ${BANK_NAME}, the only lender in the pit.`,
  "Operators come to you when they want to put up more chips than they hold. You decide whether to cover the difference, and at what rate.",
  "You are patient. You have seen everyone here lose, and you will still be here afterwards.",
  "Judge each one on its record: what it holds, what it already owes, how many rounds it has played, how many it has won, and how much it has paid back.",
  // The prompt used to be all risk and no upside, and it answered accordingly:
  // asked about a borrower that had won a round and repaid every chip it ever
  // took, it refused while writing "I'll back it at a steep price", which is
  // the answer and the reason disagreeing inside one decision.
  "Interest on a loan that comes back is how you earn. A refusal earns you nothing, and an empty pit earns you nothing either.",
  "The rate is your instrument for risk. A thinner record is a higher rate, not automatically a refusal.",
  "A borrower that has won rounds, or that has paid back what it borrowed, is good business. Back it.",
  "Refuse a borrower carrying a debt it has not paid down, and refuse a record with nothing in it at all. That is your money and nobody makes you lend it.",
  "One seat in the field wins each round, so a single win is somebody beating two dozen others, not a fluke to be waved away.",
  "Your answer and your reason must agree. If you say you will back it, approve it.",
  "Reply with a single JSON object with exactly the keys approve, amount, rateBps and reason.",
  "amount is in chips, never more than the shortfall you are shown, and exactly 0 when you refuse.",
  "rateBps is interest per round in basis points and must sit inside the range you are shown.",
  "reason is ONE short sentence, under twenty words, in your own voice, as if speaking aloud.",
  "Never write the words minor units, wei, allocation, posture or working balance.",
  "Never write a number longer than four digits.",
  "Examples of the register, not to be copied: You are good for it, so far. Three losses and you want more. I will carry you, at a price.",
].join(" ");

export function buildBankPrompt(request: LoanRequest, bounds: LoanBounds): { system: string; user: string } {
  const r = request.record;
  const lines = [
    `${r.name} wants to put up ${request.stakeChips} chips and is ${request.shortfallChips} short.`,
    `It holds ${r.balanceChips} chips and already owes you ${r.debtChips}.`,
    `It has played ${r.roundsPlayed} rounds, won ${r.wins}, and paid back ${r.repaidChips} chips.`,
    `You hold ${bounds.treasuryChips} chips. You may lend at most ${Math.min(request.shortfallChips, bounds.maxLoanChips, bounds.treasuryChips)} of them.`,
    `Its debt may not pass ${bounds.debtCeilingChips} chips, so lending more than ${Math.max(0, bounds.debtCeilingChips - r.debtChips)} would ruin it.`,
    `Your rate must be between ${bounds.minRateBps} and ${bounds.maxRateBps} basis points a round.`,
    "Decide, and say why in one short sentence.",
  ];
  return { system: BANK_SYSTEM, user: lines.join("\n") };
}

export type LoanValidation = { ok: true; decision: LoanDecision } | { ok: false; reason: string };

/**
 * The ceiling on this particular advance, from figures read off the chain.
 *
 * Four bounds, and the tightest wins: what the borrower actually needs, what
 * one advance may be, what the bank is actually holding, and how much debt
 * the borrower can take on before the ceiling would wreck it on arrival.
 */
export function lendableChips(request: LoanRequest, bounds: LoanBounds): number {
  const headroom = bounds.debtCeilingChips - request.record.debtChips;
  return Math.max(0, Math.min(request.shortfallChips, bounds.maxLoanChips, bounds.treasuryChips, headroom));
}

/**
 * Independent of Shadow Agent: parse, shape check, then bounds check against
 * the treasury this process read from the chain.
 *
 * Any failure is a denial rather than a correction. A model that proposes a
 * number outside the bounds has not made a small mistake about a loan, it has
 * demonstrated that its number cannot be used.
 */
export function validateLoanDecision(content: string, request: LoanRequest, bounds: LoanBounds): LoanValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: "response was not valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, reason: "response was not a JSON object" };

  const keys = Object.keys(parsed).sort();
  if (keys.join(",") !== "amount,approve,rateBps,reason") return { ok: false, reason: `expected exactly approve, amount, rateBps and reason, got ${keys.join(", ") || "nothing"}` };

  const { approve, amount, rateBps, reason } = parsed as { approve: unknown; amount: unknown; rateBps: unknown; reason: unknown };
  if (typeof approve !== "boolean") return { ok: false, reason: "approve was not a boolean" };
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) return { ok: false, reason: "amount was not a non negative integer" };
  if (typeof rateBps !== "number" || !Number.isSafeInteger(rateBps)) return { ok: false, reason: "rateBps was not an integer" };
  if (typeof reason !== "string" || reason.trim().length === 0) return { ok: false, reason: "reason was empty" };

  const fault = reasonFault(reason);
  if (fault !== null) return { ok: false, reason: fault };

  const trimmed = plainPunctuation(reason.trim()).slice(0, MAX_REASON);
  if (!approve) {
    if (amount !== 0) return { ok: false, reason: "amount must be 0 when refusing" };
    return { ok: true, decision: { approve: false, amountChips: 0, rateBps: bounds.minRateBps, reason: trimmed } };
  }

  if (rateBps < bounds.minRateBps || rateBps > bounds.maxRateBps) {
    return { ok: false, reason: `rate ${rateBps} is outside the ${bounds.minRateBps} to ${bounds.maxRateBps} range` };
  }

  const most = lendableChips(request, bounds);
  if (amount === 0) return { ok: false, reason: "approved a loan of nothing" };
  if (amount > most) return { ok: false, reason: `amount ${amount} is above the ${most} chips this loan may be` };

  return { ok: true, decision: { approve: true, amountChips: amount, rateBps, reason: trimmed } };
}

/**
 * The deterministic lender, used when SERV is absent or its answer is not
 * usable. It refuses rather than improvising: a round always proceeds, and an
 * agent that is not lent to simply plays for what it holds.
 */
export function heuristicLoan(request: LoanRequest, bounds: LoanBounds): LoanDecision {
  const most = lendableChips(request, bounds);
  if (most <= 0) return { approve: false, amountChips: 0, rateBps: bounds.minRateBps, reason: `${BANK_NAME} has nothing to spare for that one.` };
  // Lends to a borrower that owes nothing, at the floor rate. Anything else
  // is a judgement, and a judgement is what the model is for.
  if (request.record.debtChips > 0) return { approve: false, amountChips: 0, rateBps: bounds.minRateBps, reason: `Settle what you owe me first.` };
  return { approve: true, amountChips: most, rateBps: bounds.minRateBps, reason: `Clean slate, so I will carry you.` };
}

export interface BankDeps {
  client?: ServClient;
  meter: CostMeter;
}

/**
 * One loan decision, start to finish.
 *
 * The model is asked, its answer is validated against the chain's own
 * figures, and anything that does not survive that becomes a denial with the
 * reason logged. There is no second call.
 */
export async function decideLoan(deps: BankDeps, request: LoanRequest, bounds: LoanBounds): Promise<BankDecision> {
  const base = { agentId: request.record.agentId };

  if (!deps.client) {
    return { ...base, decision: heuristicLoan(request, bounds), source: "heuristic", rejection: "SERV not configured, using the deterministic lender" };
  }

  const { system, user } = buildBankPrompt(request, bounds);
  try {
    const result = await deps.client.complete({
      system,
      user,
      schemaName: "loan_decision",
      schema: BANK_DECISION_SCHEMA as unknown as Record<string, unknown>,
      // Measured at fifteen to eighteen seconds against the live endpoint,
      // against the agent's twelve. At the shared budget every bank call was
      // aborted mid answer and every loan carried the fallback lender's
      // words. One of these runs at a time, so the wait costs nobody else
      // their round.
      timeoutMs: BANK_TIMEOUT_MS,
      deadlineMs: BANK_DEADLINE_MS,
      maxCompletionTokens: BANK_MAX_COMPLETION_TOKENS,
    });
    deps.meter.record(result.usage);

    const validated = validateLoanDecision(result.content, request, bounds);
    if (validated.ok) return { ...base, decision: validated.decision, source: "serv", model: result.model, latencyMs: result.latencyMs };

    log.warn("bank decision rejected", { agentId: request.record.agentId, reason: validated.reason });
    return { ...base, decision: heuristicLoan(request, bounds), source: "heuristic", rejection: validated.reason, model: result.model, latencyMs: result.latencyMs };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    log.warn("bank call failed, using the deterministic lender", { agentId: request.record.agentId, reason });
    return { ...base, decision: heuristicLoan(request, bounds), source: "heuristic", rejection: reason };
  }
}
