// The decision loop. One SERV call per named agent per round returning
// strict JSON, then independent local validation before anything reaches a
// transfer.
//
// Shadow Agent is a second net, not the only one: everything SERV returns
// is parsed, schema checked and bounds checked here against the balance
// this process read from the chain, and any failure falls back to the
// deterministic heuristic. The round always proceeds.
//
// Framing note: the prompt is a resource allocation problem. An operator
// holds a budget and decides whether to commit a fixed allocation to the
// current opportunity. That framing is deliberate; do not rewrite it in
// wagering language.

import { toChips } from "@/config/stake";
import { log } from "../log";
import type { CostMeter, ServClient } from "../serv/client";
import type { AgentDecision, AgentSnapshot, Decision, RoundContext } from "./types";

/**
 * The response schema, in the subset SERV's validator accepts.
 *
 * It carried `minimum: 0` on stake and every call failed with a 400:
 *
 *   response_format.json_schema.schema: For 'integer' type, property
 *   'minimum' is not supported
 *
 * Measured against the live validator, the rejected set is the numeric range
 * keywords and only those: minimum, maximum, exclusiveMinimum,
 * exclusiveMaximum and multipleOf, on both integer and number. String
 * keywords are all accepted, as are description, default, enum and const. So
 * the bound has to be expressed somewhere that is not the schema.
 *
 * It already is, in three places, and the schema was never the one that
 * mattered. validateDecision rejects a negative, non integer or oversized
 * stake against the balance this process read from the chain. The prompt
 * states the rule. The Shadow Agent hint states it as a criterion. A model
 * cannot talk its way past any of them, and none of them trusts a number the
 * model supplied about itself.
 */
export const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["enter", "stake", "reason"],
  properties: {
    enter: { type: "boolean", description: "true to commit this round's allocation" },
    stake: { type: "integer", description: "allocation in minor units, never negative, exactly the round allocation when entering, otherwise 0" },
    reason: { type: "string", description: "one sentence naming the balance figure or participation count relied on" },
  },
} as const;

/**
 * Keywords SERV's schema validator rejects. Numeric ranges only; every
 * string keyword probed was accepted.
 */
export const UNSUPPORTED_SCHEMA_KEYWORDS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"] as const;

/** Every keyword used anywhere in a schema, however deeply nested. */
export function schemaKeywords(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const child of node) schemaKeywords(child, found);
    return found;
  }
  if (node === null || typeof node !== "object") return found;
  for (const [key, value] of Object.entries(node)) {
    found.add(key);
    schemaKeywords(value, found);
  }
  return found;
}

const MAX_REASON = 400;

/**
 * Words the answer may not contain, and a number longer than four digits.
 *
 * The register is the point: an agent that says "Working balance of
 * 99868301341612 minor units comfortably covers the 100 minor unit allocation
 * under capital-preservation posture" is unreadable to a player. Shadow Agent
 * is asked to reject these so SERV regenerates, and they are checked here too
 * because Shadow Agent is a second net and never the only one.
 */
export const FORBIDDEN_WORDS = ["minor unit", "minor units", "wei", "allocation", "posture", "working balance"] as const;
const LONG_NUMBER = /\d{5,}/;
/** A reason longer than this is not one short sentence. */
export const MAX_REASON_WORDS = 20;

/** Why a reason is not usable, or null when it reads like a person. */
export function reasonFault(reason: string): string | null {
  const lower = reason.toLowerCase();
  for (const word of FORBIDDEN_WORDS) {
    // Word boundaries, so "allocation" is caught and "location" is not.
    if (new RegExp(`\\b${word}\\b`).test(lower)) return `reason used the word "${word}"`;
  }
  const long = LONG_NUMBER.exec(reason);
  if (long) return `reason quoted the raw number ${long[0]}`;
  const words = reason.trim().split(/\s+/).filter(Boolean);
  if (words.length > MAX_REASON_WORDS) return `reason ran to ${words.length} words, over the ${MAX_REASON_WORDS} word limit`;
  return null;
}

/**
 * The input framing is unchanged: a resource allocation problem, an operator
 * with a budget deciding whether to commit to the current opportunity. That
 * framing was tested in the SERV Playground before a line was written and
 * this commit does not touch it.
 *
 * What changed is the register of the answer. It was coming back as "Working
 * balance of 99868301341612 minor units comfortably covers the 100 minor unit
 * allocation under capital-preservation posture", which is unreadable and
 * quotes a number nobody can hold in their head. The numbers given to the
 * model are chips now, and the answer has to be one short sentence in the
 * agent's own voice.
 */
const SYSTEM = [
  "You are an autonomous operator managing a balance of chips across repeated opportunities.",
  "Each period you are offered one opportunity at a fixed cost in chips. You decide whether to take it or keep your chips.",
  "Taking it puts those chips at risk: one participant receives the whole pool and the rest receive nothing.",
  "Judge it on your chips, the size of the pool, how many are taking part, and how your recent periods went, under the posture you are given.",
  "Reply with a single JSON object with exactly the keys enter, stake and reason.",
  "stake is the cost in chips, exactly the stated cost when you take it and 0 when you do not.",
  "Never propose more chips than you hold.",
  "reason is ONE short sentence, under twenty words, in your own voice, as if speaking aloud.",
  "Never write the words minor units, wei, allocation, posture or working balance.",
  "Never write a number longer than four digits.",
  "Examples of the register, not to be copied: Lost three straight, sitting this one out. Plenty in the tank, I am in. Everyone is cautious, so I am going big.",
].join(" ");

export function buildPrompt(snapshot: AgentSnapshot, round: RoundContext): { system: string; user: string } {
  const lines = [
    `You are ${snapshot.profile.name}.`,
    `Posture: ${snapshot.profile.descriptor}.`,
    `Voice: ${snapshot.profile.voice}`,
    `You hold ${toChips(snapshot.balanceWei)} chips.`,
    `This period costs ${toChips(round.stakeWei)} chips.`,
    `The pool is ${toChips(round.poolWei)} chips if everyone takes part, shared between ${round.participants} of you.`,
  ];
  if (snapshot.recentOutcomes.length > 0) {
    const recent = snapshot.recentOutcomes
      .slice(-5)
      .map((o) => {
        const chips = toChips(o.netWei < 0n ? -o.netWei : o.netWei);
        if (!o.entered) return "sat out";
        return o.netWei >= 0n ? `won ${chips}` : `lost ${chips}`;
      })
      .join(", ");
    lines.push(`Your last few periods, oldest first: ${recent}.`);
  } else {
    lines.push("You have not played yet.");
  }
  lines.push("Decide, and say why in one short sentence.");
  return { system: SYSTEM, user: lines.join("\n") };
}

export type Validation = { ok: true; decision: Decision } | { ok: false; reason: string };

/** Independent of Shadow Agent: parse, schema check, then bounds check against the real balance. */
export function validateDecision(content: string, snapshot: AgentSnapshot): Validation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: "response was not valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, reason: "response was not a JSON object" };

  const keys = Object.keys(parsed).sort();
  if (keys.join(",") !== "enter,reason,stake") return { ok: false, reason: `expected exactly enter, stake and reason, got ${keys.join(", ") || "nothing"}`};

  const { enter, stake, reason } = parsed as { enter: unknown; stake: unknown; reason: unknown };
  if (typeof enter !== "boolean") return { ok: false, reason: "enter was not a boolean" };
  if (typeof stake !== "number" || !Number.isSafeInteger(stake) || stake < 0) return { ok: false, reason: "stake was not a non negative integer" };
  if (typeof reason !== "string" || reason.trim().length === 0) return { ok: false, reason: "reason was empty" };

  const fault = reasonFault(reason);
  if (fault !== null) return { ok: false, reason: fault };

  // Bounds, checked against what the chain says, never against anything the
  // model stated. The model answers in chips, so the comparison is in chips;
  // the wei that actually moves is the round's own figure and is never taken
  // from this response.
  const balanceChips = toChips(snapshot.balanceWei);
  const roundChips = toChips(snapshot.stakeWei);
  // How far above the seat price this agent may go. One, the fixed stake,
  // unless the bank is on and there is a lender to cover the difference.
  const ceilingChips = roundChips * Math.max(1, snapshot.maxStakeMultiple ?? 1);

  if (!enter) {
    if (stake !== 0) return { ok: false, reason: "stake must be 0 when not entering" };
    return { ok: true, decision: { enter, stake, reason: reason.trim().slice(0, MAX_REASON) } };
  }

  if (ceilingChips === roundChips) {
    // No bank, so there is one seat price and nothing to borrow with.
    if (stake !== roundChips) return { ok: false, reason: `stake ${stake} is not this round's ${roundChips} chips` };
    if (stake > balanceChips) return { ok: false, reason: `stake ${stake} is more than the ${balanceChips} chips this wallet holds` };
    if (snapshot.balanceWei < snapshot.stakeWei) return { ok: false, reason: `this wallet cannot cover the ${roundChips} chips a seat costs` };
    return { ok: true, decision: { enter, stake, reason: reason.trim().slice(0, MAX_REASON) } };
  }

  // The bank is on, so a stake above the balance is a borrowing request and
  // not a lie. The bound that matters is the ceiling, and whether the bank
  // will cover the difference is decided elsewhere, against its real
  // treasury, never here and never by the model.
  if (stake < roundChips) return { ok: false, reason: `stake ${stake} is below the ${roundChips} chips a seat costs` };
  if (stake > ceilingChips) return { ok: false, reason: `stake ${stake} is above the ${ceilingChips} chip ceiling` };

  return { ok: true, decision: { enter, stake, reason: reason.trim().slice(0, MAX_REASON) } };
}

import { heuristicDecision } from "./heuristic";

export { heuristicDecision };

export interface DecisionDeps {
  client?: ServClient;
  meter: CostMeter;
}

export interface DecisionRun {
  decisions: AgentDecision[];
  rejections: Array<{ agentId: string; reason: string }>;
  guardRefusals: number;
  servCalls: number;
}

/**
 * One agent's decision, start to finish. Pulled out of the loop so the six
 * can run at once: they share nothing, each reads only its own snapshot, and
 * a failure in one has never been allowed to affect another.
 */
async function decideForAgent(deps: DecisionDeps, snapshot: AgentSnapshot, round: RoundContext): Promise<DecidedAgent> {
  const base = {
    agentId: snapshot.profile.id,
    name: snapshot.profile.name,
    strategy: snapshot.profile.strategy,
    address: snapshot.address,
    balanceWei: snapshot.balanceWei,
  };

  if (!deps.client) {
    return {
      decision: { ...base, decision: heuristicDecision(snapshot, round), source: "heuristic", rejection: "SERV not configured, using the deterministic heuristic" },
      servCall: false,
      guardRefusal: false,
    };
  }

  const { system, user } = buildPrompt(snapshot, round);
  try {
    const result = await deps.client.complete({ system, user, schemaName: "allocation_decision", schema: DECISION_SCHEMA as unknown as Record<string, unknown> });
    deps.meter.record(result.usage);

    const validated = validateDecision(result.content, snapshot);
    if (validated.ok) {
      return {
        decision: { ...base, decision: validated.decision, source: "serv", model: result.model, latencyMs: result.latencyMs },
        servCall: true,
        guardRefusal: result.guardRefusal,
      };
    }
    const reason = result.guardRefusal ? `prompt guard refusal: ${validated.reason}` : validated.reason;
    log.warn("serv decision rejected", { agentId: snapshot.profile.id, reason, guardRefusal: result.guardRefusal });
    return {
      decision: { ...base, decision: heuristicDecision(snapshot, round), source: "heuristic", rejection: reason, model: result.model, latencyMs: result.latencyMs },
      servCall: true,
      guardRefusal: result.guardRefusal,
      rejection: { agentId: snapshot.profile.id, reason },
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    log.warn("serv call failed, using heuristic", { agentId: snapshot.profile.id, reason });
    return {
      decision: { ...base, decision: heuristicDecision(snapshot, round), source: "heuristic", rejection: reason },
      servCall: true,
      guardRefusal: false,
      rejection: { agentId: snapshot.profile.id, reason },
    };
  }
}

interface DecidedAgent {
  decision: AgentDecision;
  servCall: boolean;
  guardRefusal: boolean;
  rejection?: { agentId: string; reason: string };
}

/**
 * Every agent decides at once.
 *
 * They used to decide one after another, which is six round trips end to end.
 * Measured in the browser against live SERV, that was 61 seconds of an empty
 * panel before a single agent appeared. Nothing about a decision depends on
 * another agent's answer, so the sequence bought nothing.
 *
 * onDecided fires as each one lands, so a caller can show an agent the moment
 * it reports rather than holding everything back until the slowest finishes.
 * The returned array stays in snapshot order regardless of who finished
 * first, because the round's entrant order must not depend on network timing.
 */
export async function decideForAgents(
  deps: DecisionDeps,
  snapshots: readonly AgentSnapshot[],
  round: RoundContext,
  onDecided?: (decision: AgentDecision) => void,
): Promise<DecisionRun> {
  const settled = await Promise.all(
    snapshots.map(async (snapshot) => {
      const result = await decideForAgent(deps, snapshot, round);
      onDecided?.(result.decision);
      return result;
    }),
  );

  return {
    decisions: settled.map((r) => r.decision),
    rejections: settled.flatMap((r) => (r.rejection ? [r.rejection] : [])),
    guardRefusals: settled.filter((r) => r.guardRefusal).length,
    servCalls: settled.filter((r) => r.servCall).length,
  };
}
