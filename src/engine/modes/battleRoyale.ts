// Battle Royale: everyone against everyone, last one standing takes the prize.

import { manhattan, nearestEnemy, placeFighters, rollDamage, stepToward, tileKey, type Fighter } from "../combat";
import { facingToward, type RoundEvent } from "../events";
import type { RoundMode } from "./types";

/** Ticks of escalating storm needed to burn through hp, plus slack. */
function stormTicksFor(maxHp: number, stormDamage: number): number {
  let k = 0;
  let dealt = 0;
  while (dealt < maxHp) {
    k++;
    dealt += stormDamage * k;
  }
  return k + 2;
}

export const battleRoyale: RoundMode = {
  id: "battleRoyale",
  minEntrants: 16,
  maxEntrants: 32,

  simulate(ctx) {
    const log: RoundEvent[] = [];
    const fighters = placeFighters(ctx.rng, ctx.combatants, ctx.arena);
    const occupied = new Set(fighters.map((f) => tileKey(f.x, f.y)));
    const deaths: string[] = [];
    let alive = fighters.length;
    let t = 0;

    const kill = (f: Fighter, killer: string | null): void => {
      f.alive = false;
      alive--;
      occupied.delete(tileKey(f.x, f.y));
      deaths.push(f.c.entrantId);
      log.push({ t, type: "death", actor: f.c.entrantId, target: killer, value: 0, facing: f.facing });
    };

    for (const f of fighters) {
      log.push({ t, type: "spawn", actor: f.c.entrantId, target: null, value: f.hp, facing: f.facing, x: f.x, y: f.y });
    }

    const maxHp = Math.max(...fighters.map((f) => f.hp));
    const hardCap = ctx.maxTicks + stormTicksFor(maxHp, ctx.stormDamage);

    while (alive > 1) {
      t++;
      if (t > hardCap) throw new Error(`battleRoyale did not terminate within ${hardCap} ticks`);

      for (const f of fighters) {
        if (!f.alive || alive <= 1) continue;
        const target = nearestEnemy(f, fighters);
        if (target === undefined) break;

        if (manhattan(f, target) === 1) {
          f.facing = facingToward(target.x - f.x, target.y - f.y);
          log.push({ t, type: "attack", actor: f.c.entrantId, target: target.c.entrantId, value: f.c.stats.atk, facing: f.facing });
          const dmg = rollDamage(ctx.rng, f.c.stats.atk, target.c.stats.def, ctx.damageVariancePct, ctx.minDamage);
          target.hp -= dmg;
          log.push({ t, type: "hit", actor: target.c.entrantId, target: f.c.entrantId, value: dmg, facing: target.facing, hp: Math.max(0, target.hp) });
          if (target.hp <= 0) kill(target, f.c.entrantId);
        } else {
          for (let s = 0; s < f.c.stats.spd && manhattan(f, target) > 1; s++) {
            if (!stepToward(f, target, occupied, ctx.arena)) break;
            log.push({ t, type: "move", actor: f.c.entrantId, target: null, value: 1, facing: f.facing, x: f.x, y: f.y });
          }
        }
      }

      if (t > ctx.maxTicks && alive > 1) {
        const dmg = ctx.stormDamage * (t - ctx.maxTicks);
        for (const f of fighters) {
          if (!f.alive || alive <= 1) continue;
          f.hp -= dmg;
          log.push({ t, type: "storm", actor: f.c.entrantId, target: null, value: dmg, facing: f.facing, hp: Math.max(0, f.hp) });
          if (f.hp <= 0) kill(f, null);
        }
      }
    }

    const winner = fighters.find((f) => f.alive);
    if (winner === undefined) throw new Error("battleRoyale ended with no survivor");
    log.push({ t, type: "win", actor: winner.c.entrantId, target: null, value: 0, facing: winner.facing });

    return { log, placements: [winner.c.entrantId, ...deaths.reverse()] };
  },

  distribute(prize, placements) {
    return placements.map((entrantId, i) => ({ entrantId, amount: i === 0 ? prize : 0 }));
  },
};
