// Aggregates resolved rounds into the numbers the sim harness prints.
// Reporting only: float averages are fine here, nothing feeds back into
// the engine.

import { ROSTER, type Tier } from "../../src/config/roster";
import { isFacing } from "../../src/engine/events";
import type { Combo } from "../../src/engine/reels";
import type { RoundResult } from "../../src/engine/resolveRound";

export interface Tally {
  appearances: number;
  wins: number;
}

export interface SimStats {
  rounds: number;
  entrantsPerRound: number;
  byCharacter: Record<string, Tally & { tier: Tier }>;
  byTier: Record<Tier, number>;
  byCombo: Record<Combo, Tally>;
  eventTypes: Record<string, number>;
  avgEvents: number;
  avgTicks: number;
  minTicks: number;
  maxTicks: number;
  stormRounds: number;
  /** Rounds whose payouts sum exactly to pot minus rake with non negative safe integers. */
  conservationOk: number;
  invalidFacingEvents: number;
  eventsWithoutFacing: number;
}

function conserved(r: RoundResult): boolean {
  let sum = BigInt(0);
  for (const p of r.payouts) {
    if (!Number.isSafeInteger(p.amount) || p.amount < 0) return false;
    sum += BigInt(p.amount);
  }
  return Number.isSafeInteger(r.pot) && Number.isSafeInteger(r.rake) && sum === BigInt(r.pot - r.rake);
}

export function aggregate(rounds: readonly RoundResult[]): SimStats {
  const byCharacter: SimStats["byCharacter"] = Object.fromEntries(
    ROSTER.map((e) => [e.id, { tier: e.tier, appearances: 0, wins: 0 }]),
  );
  const byTier: Record<Tier, number> = { common: 0, uncommon: 0, rare: 0 };
  const byCombo: Record<Combo, Tally> = {
    none: { appearances: 0, wins: 0 },
    pair: { appearances: 0, wins: 0 },
    threeOfAKind: { appearances: 0, wins: 0 },
  };
  const eventTypes: Record<string, number> = {};
  let events = 0;
  let ticks = 0;
  let minTicks = Number.POSITIVE_INFINITY;
  let maxTicks = 0;
  let stormRounds = 0;
  let conservationOk = 0;
  let invalidFacingEvents = 0;
  let eventsWithoutFacing = 0;

  for (const r of rounds) {
    const winner = r.placements[0];
    for (const c of r.characters) {
      byCharacter[c.characterId].appearances++;
      byTier[c.tier]++;
      byCombo[c.combo].appearances++;
      if (c.entrantId === winner) {
        byCharacter[c.characterId].wins++;
        byCombo[c.combo].wins++;
      }
    }
    let sawStorm = false;
    for (const ev of r.log) {
      eventTypes[ev.type] = (eventTypes[ev.type] ?? 0) + 1;
      if (!("facing" in ev)) eventsWithoutFacing++;
      else if (!isFacing(ev.facing)) invalidFacingEvents++;
      if (ev.type === "storm") sawStorm = true;
    }
    if (sawStorm) stormRounds++;
    const last = r.log[r.log.length - 1].t;
    events += r.log.length;
    ticks += last;
    minTicks = Math.min(minTicks, last);
    maxTicks = Math.max(maxTicks, last);
    if (conserved(r)) conservationOk++;
  }

  return {
    rounds: rounds.length,
    entrantsPerRound: rounds[0]?.characters.length ?? 0,
    byCharacter,
    byTier,
    byCombo,
    eventTypes,
    avgEvents: rounds.length ? events / rounds.length : 0,
    avgTicks: rounds.length ? ticks / rounds.length : 0,
    minTicks: rounds.length ? minTicks : 0,
    maxTicks,
    stormRounds,
    conservationOk,
    invalidFacingEvents,
    eventsWithoutFacing,
  };
}
