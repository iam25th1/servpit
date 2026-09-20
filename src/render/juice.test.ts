import { beforeAll, describe, expect, it } from "vitest";
import type { RoundEvent } from "@/engine/events";
import { createRng } from "@/engine/rng";
import type { AssetStore, Slice } from "./assets";
import type { DrawOptions, DrawTarget } from "./draw";
import { ParticleEmitter } from "./emitter";
import { DEFAULT_JUICE, Juice } from "./juice";
import { loadTestAssets, } from "./testing";
import type { ActorState, TickBatch } from "./timeline";

let store: AssetStore;
beforeAll(async () => {
  store = await loadTestAssets();
});

const unit = (seed: string) => {
  const rng = createRng(seed);
  return () => rng.nextU32() / 0x1_0000_0000;
};

const state = (id: string, patch: Partial<ActorState> = {}): ActorState => ({
  id,
  characterId: "Knight",
  tier: "common",
  x: 0, y: 0, tileX: 0, tileY: 0,
  facing: 0, hp: 100, maxHp: 100, alive: true, moving: false, diedAtTick: null,
  ...patch,
});

const tileToPixel = (x: number, y: number) => ({ px: 8 + x * 16, py: 8 + y * 16 });

function make(actors: ActorState[], seed = "juice") {
  const emitter = new ParticleEmitter(unit(seed));
  const juice = new Juice(store, emitter, tileToPixel, DEFAULT_JUICE);
  const lookup = new Map(actors.map((a) => [a.id, a]));
  const feed = (events: RoundEvent[], silent = false, t = 5) => juice.onBatch({ t, events } as TickBatch, silent, (id) => lookup.get(id)!);
  return { juice, emitter, feed, lookup };
}

const hit = (attacker: string, victim: string, hp = 50): RoundEvent[] => [
  { t: 5, type: "attack", actor: attacker, target: victim, value: 10, facing: 3 },
  { t: 5, type: "hit", actor: victim, target: attacker, value: 12, facing: 0, hp },
];

class RecordingTarget implements DrawTarget {
  readonly width = 400;
  readonly height = 400;
  slices: Array<{ slice: Slice; x: number; y: number; options?: DrawOptions }> = [];
  fills = 0;
  clear() {}
  fillRect() { this.fills++; }
  drawSlice(slice: Slice, x: number, y: number, options?: DrawOptions) { this.slices.push({ slice, x, y, options }); }
}

describe("DEFAULT_JUICE", () => {
  it("locks the documented parameters", () => {
    expect(DEFAULT_JUICE.hitstopFrames).toEqual({ death: 3, finalBlow: 5 });
    expect(DEFAULT_JUICE.flashFrames).toBe(2);
    expect(DEFAULT_JUICE.knockbackPx).toBe(3);
    expect(DEFAULT_JUICE.knockbackFrames).toBe(4);
    expect(DEFAULT_JUICE.punchScale).toBe(1.15);
    expect(DEFAULT_JUICE.punchFrames).toBe(5);
    expect(DEFAULT_JUICE.impactByTier.rare.sheetScale).toBeGreaterThan(DEFAULT_JUICE.impactByTier.common.sheetScale);
    expect(DEFAULT_JUICE.impactByTier.rare.sparks).toBeGreaterThan(DEFAULT_JUICE.impactByTier.common.sparks);
  });
});

describe("ordinary hit", () => {
  it("flashes the victim white for two frames and knocks it 3 px away from the attacker, easing back over four frames", () => {
    const attacker = state("a", { x: 2, y: 4, tileX: 2, tileY: 4 });
    const victim = state("v", { x: 3, y: 4, tileX: 3, tileY: 4 });
    const { juice, feed } = make([attacker, victim]);
    feed(hit("a", "v"));
    const fx0 = juice.actorFx().get("v")!;
    expect(fx0.white).toBe(true);
    expect(fx0.offsetX).toBeCloseTo(3);
    expect(fx0.offsetY).toBeCloseTo(0);
    juice.frame();
    expect(juice.actorFx().get("v")!.white).toBe(true);
    juice.frame();
    const fx2 = juice.actorFx().get("v")!;
    expect(fx2.white).toBe(false);
    expect(fx2.offsetX).toBeCloseTo(3 * (1 - 2 / 4));
    juice.frame();
    juice.frame();
    expect(juice.actorFx().get("v")?.offsetX ?? 0).toBeCloseTo(0);
  });

  it("knocks back along the attacker to victim direction, including vertical", () => {
    const attacker = state("a", { x: 5, y: 6, tileX: 5, tileY: 6 });
    const victim = state("v", { x: 5, y: 5, tileX: 5, tileY: 5 });
    const { juice, feed } = make([attacker, victim]);
    feed(hit("a", "v"));
    const fx = juice.actorFx().get("v")!;
    expect(fx.offsetX).toBeCloseTo(0);
    expect(fx.offsetY).toBeCloseTo(-3);
  });

  it("punches the attacker to 1.15x on the contact frame, settling over five frames, in the attack pose", () => {
    const { juice, feed } = make([state("a", { x: 2, y: 4 }), state("v", { x: 3, y: 4 })]);
    feed(hit("a", "v"));
    expect(juice.actorFx().get("a")!.scale).toBeCloseTo(1.15);
    expect(juice.actorFx().get("a")!.attacking).toBe(true);
    for (let i = 0; i < 5; i++) juice.frame();
    expect(juice.actorFx().get("a")?.scale ?? 1).toBeCloseTo(1);
  });

  it("never freezes actors, even for twenty three hits in one tick", () => {
    const actors = Array.from({ length: 24 }, (_, i) => state(`p${i}`, { x: i % 6, y: Math.floor(i / 6) }));
    const { juice, feed } = make(actors);
    const events: RoundEvent[] = [];
    for (let i = 0; i < 23; i++) events.push(...hit(`p${i}`, `p${(i + 1) % 24}`));
    feed(events);
    expect(juice.frozen).toBe(false);
  });

  it("spawns the attacker tier's impact sheet and sparks at the midpoint between the two sprites", () => {
    const attacker = state("a", { x: 2, y: 4, tileX: 2, tileY: 4, tier: "rare" });
    const victim = state("v", { x: 3, y: 4, tileX: 3, tileY: 4 });
    const { juice, feed, emitter } = make([attacker, victim]);
    feed(hit("a", "v"));
    const sheets = juice.activeSheets();
    expect(sheets).toHaveLength(1);
    expect(sheets[0].id).toBe(DEFAULT_JUICE.impactByTier.rare.sheet);
    const mid = { x: (tileToPixel(2.5, 4.5).px + tileToPixel(3.5, 4.5).px) / 2, y: tileToPixel(3, 4.5).py };
    expect(sheets[0].x).toBeCloseTo(mid.x);
    expect(sheets[0].y).toBeCloseTo(mid.y);
    expect(emitter.count).toBeGreaterThan(0);
  });
});

describe("death and final blow", () => {
  const death = (killer: string, victim: string): RoundEvent[] => [
    ...hit(killer, victim, 0),
    { t: 5, type: "death", actor: victim, target: killer, value: 0, facing: 0 },
  ];

  it("hitstops for three frames on a death, and only actors freeze", () => {
    const { juice, feed } = make([state("a", { x: 2, y: 4 }), state("v", { x: 3, y: 4 })]);
    feed(death("a", "v"));
    expect(juice.frozen).toBe(true);
    juice.frame();
    juice.frame();
    expect(juice.frozen).toBe(true);
    juice.frame();
    expect(juice.frozen).toBe(false);
  });

  it("keeps effects animating during hitstop", () => {
    const { juice, feed } = make([state("a", { x: 2, y: 4 }), state("v", { x: 3, y: 4 })]);
    feed(death("a", "v"));
    const before = juice.activeSheets().map((s) => s.frame);
    juice.update(120);
    const after = juice.activeSheets().map((s) => s.frame);
    expect(after.some((f, i) => f > before[i])).toBe(true);
  });

  it("caps at one hitstop per tick no matter how many deaths land together", () => {
    const actors = ["a", "b", "c", "d"].map((id, i) => state(id, { x: i, y: 0 }));
    const { juice, feed } = make(actors);
    feed([...death("a", "b"), ...death("c", "d"), ...death("a", "c")]);
    let frames = 0;
    while (juice.frozen) {
      juice.frame();
      frames++;
      if (frames > 20) break;
    }
    expect(frames).toBe(3);
  });

  it("hitstops for five frames on the final blow of the round", () => {
    const { juice, feed } = make([state("a", { x: 2, y: 4 }), state("v", { x: 3, y: 4 })]);
    feed([...death("a", "v"), { t: 5, type: "win", actor: "a", target: null, value: 0, facing: 3 }]);
    let frames = 0;
    while (juice.frozen && frames < 20) {
      juice.frame();
      frames++;
    }
    expect(frames).toBe(5);
  });

  it("adds smoke on the victim for a death and an explosion at the midpoint for the killing blow", () => {
    const { juice, feed } = make([state("a", { x: 2, y: 4, tileX: 2, tileY: 4 }), state("v", { x: 3, y: 4, tileX: 3, tileY: 4 })]);
    feed(death("a", "v"));
    const ids = juice.activeSheets().map((s) => s.id);
    expect(ids).toContain("Smoke");
    expect(ids).toContain("Explosion");
    const smoke = juice.activeSheets().find((s) => s.id === "Smoke")!;
    expect(smoke.x).toBeCloseTo(tileToPixel(3.5, 4.5).px);
  });

  it("fades a dead actor toward the corpse alpha over frames", () => {
    const { juice, feed, lookup } = make([state("a", { x: 2, y: 4 }), state("v", { x: 3, y: 4 })]);
    feed(death("a", "v"));
    lookup.set("v", state("v", { x: 3, y: 4, alive: false, hp: 0, diedAtTick: 5 }));
    for (let i = 0; i < 6; i++) juice.frame();
    const early = juice.actorFx().get("v")!.alpha;
    for (let i = 0; i < 60; i++) juice.frame();
    const late = juice.actorFx().get("v")!.alpha;
    expect(early).toBeLessThan(1);
    expect(late).toBeLessThan(early);
    expect(late).toBeGreaterThan(0);
  });
});

describe("silence, reset and drawing", () => {
  it("does nothing for a silent batch (seek) and reset clears everything", () => {
    const { juice, feed, emitter } = make([state("a", { x: 2, y: 4 }), state("v", { x: 3, y: 4 })]);
    feed([...hit("a", "v", 0), { t: 5, type: "death", actor: "v", target: "a", value: 0, facing: 0 }], true);
    expect(juice.frozen).toBe(false);
    expect(juice.activeSheets()).toHaveLength(0);
    expect(emitter.count).toBe(0);
    expect(juice.actorFx().size).toBe(0);
    feed(hit("a", "v"));
    juice.reset();
    expect(juice.activeSheets()).toHaveLength(0);
    expect(juice.actorFx().size).toBe(0);
    expect(emitter.count).toBe(0);
  });

  it("draws sheet frames centred on their point and particles, then drops finished sheets", () => {
    const { juice, feed } = make([state("a", { x: 2, y: 4, tileX: 2, tileY: 4 }), state("v", { x: 3, y: 4, tileX: 3, tileY: 4 })]);
    feed(hit("a", "v"));
    const target = new RecordingTarget();
    juice.drawEffects(target);
    expect(target.slices.length).toBeGreaterThan(0);
    const s = target.slices[0];
    const sheet = juice.activeSheets()[0];
    expect(s.x + s.slice.sw / 2).toBeCloseTo(sheet.x);
    expect(s.y + s.slice.sh / 2).toBeCloseTo(sheet.y);
    expect(target.fills).toBeGreaterThan(0);
    juice.update(5000);
    expect(juice.activeSheets()).toHaveLength(0);
  });
});
