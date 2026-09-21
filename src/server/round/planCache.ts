// Holds the plan a round was quoted with, so settling it does not decide
// everything a second time.
//
// /api/round/plan runs the decision loop and returns it. /api/round/run then
// ran planRound again from the same seed, which means six more SERV calls
// before a single coin moved. Measured in the browser, that was 68.9 seconds
// of a frozen "Locked in" after the lever, on top of the 61 the decision
// phase already took.
//
// It also meant the player was shown one set of decisions and the round
// settled against another. planRound is not deterministic: a model answers
// differently on the same prompt, and an agent that said yes on screen could
// say no when it counted.
//
// The plan is cached server side and keyed by round id, which is derived
// from the seed and the entrant count on the server. A client cannot put
// decisions into it, which is the property that matters: the entrant list
// and the stakes still come from the server that read the balances.

import type { RoundPlan } from "./flow";

export interface PlanCacheOptions {
  /** How long a quoted plan stays good. */
  ttlMs?: number;
  /** Most plans held at once, oldest evicted first. */
  max?: number;
  now?: () => number;
}

/** Long enough to pull the lever, short enough that balances are still true. */
export const DEFAULT_PLAN_TTL_MS = 10 * 60 * 1000;

export class PlanCache {
  private readonly entries = new Map<string, { plan: RoundPlan; at: number }>();
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly now: () => number;

  constructor(options: PlanCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_PLAN_TTL_MS;
    this.max = options.max ?? 64;
    this.now = options.now ?? Date.now;
  }

  put(plan: RoundPlan): void {
    // Insertion order is eviction order, so a refreshed plan moves to the end.
    this.entries.delete(plan.roundId);
    this.entries.set(plan.roundId, { plan, at: this.now() });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** The plan for this round, or undefined if it was never quoted or has expired. */
  get(roundId: string): RoundPlan | undefined {
    const found = this.entries.get(roundId);
    if (!found) return undefined;
    if (this.now() - found.at > this.ttlMs) {
      this.entries.delete(roundId);
      return undefined;
    }
    return found.plan;
  }

  get size(): number {
    return this.entries.size;
  }
}
