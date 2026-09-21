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

import { createHash } from "node:crypto";
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

const SYSTEM = [
  "You are an autonomous treasury operator managing a working balance across repeated opportunities.",
  "Each period you are offered one opportunity with a fixed allocation size. You decide whether to commit that allocation or hold your balance.",
  "Committing puts the allocation at risk: one participant receives the whole pooled amount and the rest receive nothing.",
  "Judge the opportunity on your balance, the pooled amount, how many participants share it, and your recent results, under the posture you are given.",
  "Reply with a single JSON object with exactly the keys enter, stake and reason. stake is the allocation in minor units, exactly the stated allocation when entering and 0 when holding.",
  "Never propose an allocation larger than your stated balance. Keep reason to one sentence that names the balance figure or the participation count you relied on.",
].join(" ");

export function buildPrompt(snapshot: AgentSnapshot, round: RoundContext): { system: string; user: string } {
  const lines = [
    `Operator: ${snapshot.profile.name}.`,
    `Posture: ${snapshot.profile.descriptor}.`,
    `Working balance: ${snapshot.balanceWei} minor units.`,
    `Allocation offered this period: ${round.stakeWei} minor units.`,
    `Pooled amount if every participant commits: ${round.poolWei} minor units across ${round.participants} participants.`,
  ];
  if (snapshot.recentOutcomes.length > 0) {
    const recent = snapshot.recentOutcomes
      .slice(-5)
      .map((o) => `${o.entered ? "committed" : "held"} ${o.netWei >= 0n ? "+" : ""}${o.netWei}`)
      .join(", ");
    lines.push(`Recent results, oldest first: ${recent}.`);
  } else {
    lines.push("No recent results yet.");
  }
  lines.push("Decide whether to commit this period's allocation.");
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

  // Bounds, checked against what the chain says, never against anything the
  // model stated. The round stake is fixed, so entering means exactly it.
  const stakeWei = BigInt(stake);
  if (stakeWei > snapshot.balanceWei) {
    return { ok: false, reason: `stake ${stake} exceeds on chain balance ${snapshot.balanceWei}` };
  }
  if (enter) {
    if (stakeWei !== snapshot.stakeWei) return { ok: false, reason: `stake ${stake} is not this round's allocation ${snapshot.stakeWei}` };
    if (snapshot.balanceWei < snapshot.stakeWei) return { ok: false, reason: `balance ${snapshot.balanceWei} cannot cover the allocation ${snapshot.stakeWei}` };
  } else if (stake !== 0) {
    return { ok: false, reason: "stake must be 0 when not entering" };
  }

  return { ok: true, decision: { enter, stake, reason: reason.trim().slice(0, MAX_REASON) } };
}

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
