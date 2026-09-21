// The plan a round was quoted with, persisted, and the only thing a settle is
// allowed to read.
//
// WHY THIS IS A STORE AND NOT A CACHE. What the player sees must be exactly
// what settles, and that has now failed twice. In phase 7 the client asked
// for the plan with one seed and the run with another, so the decisions on
// screen and the transfers that settled belonged to two unrelated rounds. In
// phase 11 the run endpoint reran the whole decision loop, and planRound is
// not deterministic, so a model free to answer differently could and did.
//
// Phase 11 added a cache, which was not enough: it was a fallback, so a miss
// silently re-planned and the exposure came straight back. This persists the
// plan under an id, and the settle path refuses to run without one. A miss is
// an error the operator sees, never a quiet second opinion.
//
// Phase 12 adds a second decision phase for loans with exactly the same
// exposure, which is why this is structural rather than another patch.

import { StoreFile, UNKNOWN_NETWORK } from "../store/file";
import type { RoundPlan } from "./flow";

/** A plan as it survives a restart. bigint has no JSON form. */
interface StoredPlan {
  planId: string;
  quotedAt: string;
  /** The whole plan, with every bigint written as a decimal string. */
  plan: unknown;
}

/** Long enough to read the lineup and pull the lever. */
export const DEFAULT_PLAN_TTL_MS = 10 * 60 * 1000;

/** Plans kept before the oldest is dropped. */
const MAX_PLANS = 200;

const encode = (value: unknown): unknown => {
  if (typeof value === "bigint") return { __wei: value.toString() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  }
  return value;
};

const decode = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.__wei === "string") return BigInt(rec.__wei);
    return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, decode(v)]));
  }
  return value;
};

export class PlanNotQuoted extends Error {
  /** Stable discriminant, so a route can classify this without instanceof. */
  readonly code = "round_expired" as const;
  constructor(readonly planId: string) {
    super(`no quoted plan for ${planId}. A round can only settle against a plan that was shown, never one worked out again at settle time.`);
    this.name = "PlanNotQuoted";
  }
}

export interface PlanStoreOptions {
  ttlMs?: number;
  now?: () => number;
}

export class PlanStore {
  private plans: StoredPlan[] = [];
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly sync: StoreFile;

  /**
   * Written by the route that plans and read by the route that settles, which
   * build separate contexts in one process. Read once at construction, the
   * settle side could only ever find plans that existed when it was built: the
   * first round of a process settled and every round after it was refused with
   * "that round is no longer on the table", which is a plan that was quoted
   * being called expired.
   */
  constructor(file: string, options: PlanStoreOptions = {}, network: string = UNKNOWN_NETWORK) {
    this.ttlMs = options.ttlMs ?? DEFAULT_PLAN_TTL_MS;
    this.now = options.now ?? Date.now;
    this.sync = new StoreFile(file, network, (body) => {
      const plans = body?.plans;
      this.plans = Array.isArray(plans) ? (plans as StoredPlan[]).filter((p) => p && typeof p.planId === "string") : [];
    });
    this.sync.read();
  }

  /** Records the plan a round was quoted with. */
  put(plan: RoundPlan): void {
    this.sync.read();
    this.plans = this.plans.filter((p) => p.planId !== plan.roundId);
    this.plans.push({ planId: plan.roundId, quotedAt: new Date(this.now()).toISOString(), plan: encode(plan) });
    if (this.plans.length > MAX_PLANS) this.plans = this.plans.slice(-MAX_PLANS);
    this.flush();
  }

  /**
   * The plan this round was quoted with.
   *
   * Throws rather than returning undefined. A settle that cannot find its
   * plan must stop, because the alternative is working one out again, and a
   * second opinion is exactly what this exists to prevent.
   */
  require(planId: string): RoundPlan {
    this.sync.read();
    const found = this.plans.find((p) => p.planId === planId);
    if (!found) throw new PlanNotQuoted(planId);
    if (this.now() - Date.parse(found.quotedAt) > this.ttlMs) throw new PlanNotQuoted(planId);
    return decode(found.plan) as RoundPlan;
  }

  /** Whether a plan is on file and still good. Never re-plans. */
  has(planId: string): boolean {
    try {
      this.require(planId);
      return true;
    } catch {
      return false;
    }
  }

  private flush(): void {
    this.sync.write({ version: 1, plans: this.plans });
  }
}
