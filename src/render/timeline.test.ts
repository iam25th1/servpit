import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TICK_MS } from "@/config/playback";
import { DEFAULT_ROUND } from "@/config/round";
import type { Combatant } from "@/engine/combat";
import type { RoundEvent } from "@/engine/events";
import { resolveRound } from "@/engine/resolveRound";
import { Timeline, type TickBatch } from "./timeline";

const entrants = Array.from({ length: 24 }, (_, i) => ({ id: `p${i}` }));
const round = resolveRound("timeline", entrants, DEFAULT_ROUND);

const combatant = (entrantId: string, hp: number): Combatant => ({
  entrantId,
  characterId: "Knight",
  tier: "common",
  stats: { hp, atk: 10, def: 0, spd: 2 },
  modifierId: "none",
  statRollPct: 0,
  combo: "none",
  bonusPct: 0,
});

/** Two actors: a walks two tiles right in tick 1, hits b in tick 2, b dies in tick 3. */
const synthetic = {
  characters: [combatant("a", 50), combatant("b", 20)],
  log: [
    { t: 0, type: "spawn", actor: "a", target: null, value: 50, facing: 0, x: 2, y: 5 },
    { t: 0, type: "spawn", actor: "b", target: null, value: 20, facing: 0, x: 6, y: 5 },
    { t: 1, type: "move", actor: "a", target: null, value: 1, facing: 3, x: 3, y: 5 },
    { t: 1, type: "move", actor: "a", target: null, value: 1, facing: 3, x: 4, y: 5 },
    { t: 2, type: "move", actor: "a", target: null, value: 1, facing: 3, x: 5, y: 5 },
    { t: 2, type: "attack", actor: "a", target: "b", value: 10, facing: 3 },
    { t: 2, type: "hit", actor: "b", target: "a", value: 12, facing: 0, hp: 8 },
    { t: 3, type: "attack", actor: "a", target: "b", value: 10, facing: 3 },
    { t: 3, type: "hit", actor: "b", target: "a", value: 12, facing: 0, hp: 0 },
    { t: 3, type: "death", actor: "b", target: "a", value: 0, facing: 0 },
    { t: 3, type: "win", actor: "a", target: null, value: 0, facing: 3 },
  ] as RoundEvent[],
};

describe("Timeline construction", () => {
  it("defaults to the configured tick and reports duration from the last tick", () => {
    const tl = new Timeline(round);
    expect(tl.tickMs).toBe(TICK_MS);
    expect(TICK_MS).toBe(320);
    expect(tl.lastTick).toBe(round.log[round.log.length - 1].t);
    expect(tl.durationMs).toBe(tl.lastTick * TICK_MS);
    expect(new Timeline(round, { tickMs: 50 }).durationMs).toBe(tl.lastTick * 50);
  });

  it("rejects a non positive tick duration", () => {
    expect(() => new Timeline(round, { tickMs: 0 })).toThrow(RangeError);
  });

  it("starts at time 0 with every actor spawned on its spawn tile", () => {
    const tl = new Timeline(round);
    expect(tl.timeMs).toBe(0);
    expect(tl.tick).toBe(0);
    const spawns = round.log.filter((ev) => ev.type === "spawn");
    expect(tl.actors()).toHaveLength(24);
    for (const ev of spawns) {
      const a = tl.actor(ev.actor);
      expect([a.x, a.y, a.hp, a.maxHp, a.alive, a.facing]).toEqual([ev.x, ev.y, ev.value, ev.value, true, 0]);
    }
  });
});

describe("Timeline batching", () => {
  it("delivers each tick's events as one batch, in order, even when one advance spans several ticks", () => {
    const tl = new Timeline(round);
    const seen: TickBatch[] = [];
    tl.onBatch((b) => seen.push(b));
    tl.play();
    tl.advance(TICK_MS * 3 + 50);
    expect(seen.map((b) => b.t)).toEqual([1, 2, 3]);
    for (const b of seen) expect(b.events).toEqual(round.log.filter((ev) => ev.t === b.t));
    expect(tl.tick).toBe(3);
    expect(tl.progress).toBeCloseTo(50 / TICK_MS);
  });

  it("does not advance while paused", () => {
    const tl = new Timeline(round);
    tl.advance(1000);
    expect(tl.timeMs).toBe(0);
  });

  it("clamps at the end, flags finished, and stops playing", () => {
    const tl = new Timeline(round);
    tl.play();
    tl.advance(1e9);
    expect(tl.timeMs).toBe(tl.durationMs);
    expect(tl.finished).toBe(true);
    expect(tl.playing).toBe(false);
    expect(tl.actors().filter((a) => a.alive)).toHaveLength(1);
  });
});

describe("Timeline actor state", () => {
  it("interpolates linearly through every move of the tick and flags moving", () => {
    const tl = new Timeline(synthetic, { tickMs: 100 });
    tl.play();
    tl.advance(25);
    let a = tl.actor("a");
    expect(a.x).toBeCloseTo(2.5);
    expect(a.y).toBe(5);
    expect(a.moving).toBe(true);
    expect(tl.actor("b").moving).toBe(false);
    tl.advance(50);
    a = tl.actor("a");
    expect(a.x).toBeCloseTo(3.5);
    tl.advance(25);
    a = tl.actor("a");
    expect(a.x).toBe(4);
    expect(a.tileX).toBe(4);
    expect(a.moving).toBe(false);
  });

  it("takes facing from the latest event that animates the actor", () => {
    const tl = new Timeline(synthetic, { tickMs: 100 });
    expect(tl.actor("a").facing).toBe(0);
    tl.play();
    tl.advance(100);
    expect(tl.actor("a").facing).toBe(3);
  });

  it("applies post damage hp and death from the batch", () => {
    // An explicit tick, so the advances here are multiples of that 100 and
    // not of the configured default.
    const tl = new Timeline(synthetic, { tickMs: 100 });
    tl.play();
    tl.advance(2 * 100);
    expect(tl.actor("b").hp).toBe(8);
    expect(tl.actor("b").alive).toBe(true);
    tl.advance(100);
    expect(tl.actor("b").hp).toBe(0);
    expect(tl.actor("b").alive).toBe(false);
    expect(tl.actor("b").diedAtTick).toBe(3);
    expect(tl.actor("a").alive).toBe(true);
  });

  it("reconciles hp against the log for a full real round", () => {
    const tl = new Timeline(round);
    tl.play();
    tl.advance(tl.durationMs);
    const deaths = round.log.filter((ev) => ev.type === "death").map((ev) => ev.actor);
    for (const a of tl.actors()) expect(a.alive).toBe(!deaths.includes(a.id));
    const lastHp = new Map<string, number>();
    for (const ev of round.log) {
      if (ev.type === "spawn") lastHp.set(ev.actor, ev.value);
      if (ev.hp !== undefined) lastHp.set(ev.actor, ev.hp);
    }
    for (const a of tl.actors()) expect(a.hp).toBe(lastHp.get(a.id));
  });
});

describe("Timeline seek and restart", () => {
  const snapshot = (tl: Timeline) => tl.actors().map((a) => ({ ...a }));

  it("seek reproduces the state reached by stepping, forwards and backwards, without notifying loudly", () => {
    const stepped = new Timeline(round);
    stepped.play();
    for (let i = 0; i < 37; i++) stepped.advance(33);
    const sought = new Timeline(round);
    const loud: boolean[] = [];
    sought.onBatch((_b, silent) => loud.push(!silent));
    sought.seek(37 * 33);
    expect(snapshot(sought)).toEqual(snapshot(stepped));
    expect(loud.every((l) => l === false)).toBe(true);
    sought.seek(2 * TICK_MS + 10);
    expect(sought.tick).toBe(2);
    const twice = new Timeline(round);
    twice.play();
    twice.advance(2 * TICK_MS + 10);
    expect(snapshot(sought)).toEqual(snapshot(twice));
  });

  it("restart returns to time 0 with spawn state and resumes playing", () => {
    const tl = new Timeline(round);
    tl.play();
    tl.advance(1e9);
    expect(tl.finished).toBe(true);
    tl.restart();
    expect(tl.timeMs).toBe(0);
    expect(tl.playing).toBe(true);
    expect(tl.finished).toBe(false);
    expect(snapshot(tl)).toEqual(snapshot(new Timeline(round)));
  });
});

describe("render source hygiene", () => {
  it("no timers or clocks anywhere in src/render except loop.ts", () => {
    const banned = [/setTimeout/, /setInterval/, /requestAnimationFrame/, /Date\.now/, /performance\.now/];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith("loop.ts")) {
          const body = readFileSync(p, "utf8");
          if (banned.some((re) => re.test(body))) offenders.push(p);
        }
      }
    };
    walk(join(process.cwd(), "src/render"));
    expect(offenders).toEqual([]);
  });
});

describe("slot source hygiene", () => {
  it("no timers or clocks in the slot code or the play screen either", () => {
    const banned = [/setTimeout/, /setInterval/, /requestAnimationFrame/, /Date\.now/, /performance\.now/];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) {
          const body = readFileSync(p, "utf8");
          if (banned.some((re) => re.test(body))) offenders.push(p);
        }
      }
    };
    walk(join(process.cwd(), "src/render/slot"));
    walk(join(process.cwd(), "src/app/play"));
    expect(offenders).toEqual([]);
  });

  it("the ban covers first party source only, and anime.js is whitelisted by name", () => {
    // anime.js schedules on requestAnimationFrame internally, which is fine:
    // it drives DOM chrome and nothing else, and the rule exists to stop our
    // own code opening a second clock. The whitelist is explicit rather than
    // the rule being softened, so importing any other timing library still
    // fails this.
    const allowed = new Set(["animejs", "animejs/svg", "animejs/text", "animejs/scope"]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) {
          for (const match of readFileSync(p, "utf8").matchAll(/from "([^"]+)"/g)) {
            const source = match[1];
            if (!source.startsWith(".") && !source.startsWith("@/") && /anime|gsap|motion|framer|tween|popmotion/i.test(source)) {
              if (!allowed.has(source)) offenders.push(`${p}: ${source}`);
            }
          }
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });

  it("only loop.ts opens a raw animation frame in the rendering layer", () => {
    // Scoped to what renders. src/server schedules an HTTP retry backoff,
    // which is a different concern from the animation clock and is not what
    // this rule protects.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.endsWith("loop.ts")) {
          if (/requestAnimationFrame|setInterval\(|setTimeout\(/.test(readFileSync(p, "utf8"))) offenders.push(p);
        }
      }
    };
    for (const dir of ["src/render", "src/ui", "src/app"]) walk(join(process.cwd(), dir));
    expect(offenders).toEqual([]);
  });
});
