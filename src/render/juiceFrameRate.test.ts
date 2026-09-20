import { beforeAll, describe, expect, it } from "vitest";
import type { RoundEvent } from "@/engine/events";
import { createRng } from "@/engine/rng";
import type { AssetStore } from "./assets";
import { ParticleEmitter } from "./emitter";
import { DEFAULT_JUICE, Juice } from "./juice";
import { loadTestAssets } from "./testing";
import type { ActorState } from "./timeline";

/**
 * The juice layer used to count render frames. A frame is not a unit of time:
 * it is 16.7 ms on a 60 Hz display and 8.3 ms on a 120 Hz one, so every
 * impact duration ran at half length on the faster display. These tests drive
 * the same wall time through two different delta streams and assert the
 * durations match.
 */
const HZ_60 = 1000 / 60;
const HZ_120 = 1000 / 120;
const HZ_144 = 1000 / 144;

let store: AssetStore;
beforeAll(async () => {
  store = await loadTestAssets();
});

const actor = (id: string, x: number, y: number): ActorState => ({
  id,
  // These fixtures are about frame rate, not naming. Unlabelled is right.
  name: null,
  characterId: "Knight",
  tier: "common",
  x,
  y,
  tileX: x,
  tileY: y,
  facing: 0,
  hp: 100,
  maxHp: 100,
  alive: true,
  moving: false,
  diedAtTick: null,
});

const make = (actors: ActorState[]) => {
  const rng = createRng("frame-rate");
  const emitter = new ParticleEmitter(() => rng.nextU32() / 0x1_0000_0000);
  const juice = new Juice(store, emitter, (x, y) => ({ px: x * 16, py: y * 16 }));
  const lookup = (id: string) => actors.find((a) => a.id === id);
  const feed = (events: RoundEvent[]) => juice.onBatch({ t: 1, events }, false, lookup);
  return { juice, feed };
};

const hit = (attacker: string, victim: string): RoundEvent[] => [
  { t: 1, type: "hit", actor: victim, target: attacker, value: 10, facing: 0, hp: 90 },
];
const death = (killer: string, victim: string): RoundEvent[] => [
  ...hit(killer, victim),
  { t: 1, type: "death", actor: victim, target: killer, value: 0, facing: 0 },
];

/** Wall time until predicate stops holding, stepping by one frame at a time. */
function millisecondsUntil(juice: Juice, step: number, holds: () => boolean, capMs = 5000): number {
  let elapsed = 0;
  while (holds() && elapsed < capMs) {
    juice.advance(step);
    elapsed += step;
  }
  return elapsed;
}

describe("every impact duration is the same wall time at any refresh rate", () => {
  it("holds hitstop for the same time at 60, 120 and 144 Hz", () => {
    const measure = (step: number): number => {
      const { juice, feed } = make([actor("a", 2, 4), actor("v", 3, 4)]);
      feed(death("a", "v"));
      return millisecondsUntil(juice, step, () => juice.frozen);
    };
    const at60 = measure(HZ_60);
    const at120 = measure(HZ_120);
    const at144 = measure(HZ_144);
    // Within one step of the faster stream, which is all the resolution a
    // stepped clock can give.
    expect(at120).toBeGreaterThan(at60 - HZ_60);
    expect(at120).toBeLessThan(at60 + HZ_60);
    expect(at144).toBeGreaterThan(at60 - HZ_60);
    expect(at144).toBeLessThan(at60 + HZ_60);
    expect(at60).toBeCloseTo(DEFAULT_JUICE.hitstopMs.death, 0);
  });

  it("holds the impact flash for the same time at 60 and 120 Hz", () => {
    const measure = (step: number): number => {
      const { juice, feed } = make([actor("a", 2, 4), actor("v", 3, 4)]);
      feed(hit("a", "v"));
      return millisecondsUntil(juice, step, () => juice.actorFx().get("v")?.white === true);
    };
    const at60 = measure(HZ_60);
    const at120 = measure(HZ_120);
    expect(at120).toBeGreaterThan(at60 - HZ_60);
    expect(at120).toBeLessThan(at60 + HZ_60);
    expect(at60).toBeCloseTo(DEFAULT_JUICE.flashMs, 0);
  });

  it("settles the knockback over the same time at 60 and 120 Hz", () => {
    const measure = (step: number): number => {
      const { juice, feed } = make([actor("a", 2, 4), actor("v", 3, 4)]);
      feed(hit("a", "v"));
      return millisecondsUntil(juice, step, () => (juice.actorFx().get("v")?.offsetX ?? 0) > 0.0001);
    };
    const at60 = measure(HZ_60);
    const at120 = measure(HZ_120);
    expect(at120).toBeGreaterThan(at60 - HZ_60);
    expect(at120).toBeLessThan(at60 + HZ_60);
    expect(at60).toBeCloseTo(DEFAULT_JUICE.knockbackMs, 0);
  });

  it("settles the punch over the same time at 60 and 120 Hz", () => {
    const measure = (step: number): number => {
      const { juice, feed } = make([actor("a", 2, 4), actor("v", 3, 4)]);
      feed(hit("a", "v"));
      return millisecondsUntil(juice, step, () => (juice.actorFx().get("a")?.scale ?? 1) > 1.0001);
    };
    const at60 = measure(HZ_60);
    const at120 = measure(HZ_120);
    expect(at120).toBeGreaterThan(at60 - HZ_60);
    expect(at120).toBeLessThan(at60 + HZ_60);
    expect(at60).toBeCloseTo(DEFAULT_JUICE.punchMs, 0);
  });

  it("holds the attack pose for the same time at 60 and 120 Hz", () => {
    const measure = (step: number): number => {
      const { juice, feed } = make([actor("a", 2, 4), actor("v", 3, 4)]);
      feed(hit("a", "v"));
      return millisecondsUntil(juice, step, () => juice.actorFx().get("a")?.attacking === true);
    };
    const at60 = measure(HZ_60);
    const at120 = measure(HZ_120);
    expect(at120).toBeGreaterThan(at60 - HZ_60);
    expect(at120).toBeLessThan(at60 + HZ_60);
    expect(at60).toBeCloseTo(DEFAULT_JUICE.attackPoseMs, 0);
  });

  it("fades a corpse over the same time at 60 and 120 Hz", () => {
    const measure = (step: number): number => {
      const { juice, feed } = make([actor("a", 2, 4), actor("v", 3, 4)]);
      feed(death("a", "v"));
      // Step past the hitstop first, which is measured on its own above.
      millisecondsUntil(juice, step, () => juice.frozen);
      return millisecondsUntil(juice, step, () => (juice.actorFx().get("v")?.alpha ?? 0) > DEFAULT_JUICE.corpseAlpha + 0.0001);
    };
    const at60 = measure(HZ_60);
    const at120 = measure(HZ_120);
    expect(at120).toBeGreaterThan(at60 - HZ_60);
    expect(at120).toBeLessThan(at60 + HZ_60);
    expect(at60).toBeCloseTo(DEFAULT_JUICE.deadFadeMs, 0);
  });

  it("advances effects by wall time whatever the refresh rate, including while frozen", () => {
    const measure = (step: number): number => {
      const { juice, feed } = make([actor("a", 2, 4), actor("v", 3, 4)]);
      feed(death("a", "v"));
      let elapsed = 0;
      while (juice.activeSheets().length > 0 && elapsed < 5000) {
        juice.advance(step);
        elapsed += step;
      }
      return elapsed;
    };
    // Within one step of the faster stream; a stepped clock cannot do better.
    expect(Math.abs(measure(HZ_120) - measure(HZ_60))).toBeLessThanOrEqual(HZ_60 + 1e-6);
  });

  it("is unmoved by a single long delta, so a stalled tab does not skip an effect", () => {
    const { juice, feed } = make([actor("a", 2, 4), actor("v", 3, 4)]);
    feed(hit("a", "v"));
    juice.advance(1000);
    expect(juice.actorFx().get("v")?.white ?? false).toBe(false);
    expect(juice.actorFx().get("v")?.offsetX ?? 0).toBeCloseTo(0);
  });
});
