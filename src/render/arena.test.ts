import { beforeAll, describe, expect, it } from "vitest";
import type { AssetStore, Slice } from "./assets";
import { ArenaRenderer, NEUTRAL_FX, PALETTE, type ActorFx } from "./arena";
import type { DrawOptions, DrawTarget } from "./draw";
import { loadTestAssets } from "./testing";
import type { ActorState } from "./timeline";

type Call =
  | { kind: "clear"; color: string }
  | { kind: "fill"; x: number; y: number; w: number; h: number; color: string; alpha: number }
  | { kind: "slice"; slice: Slice; x: number; y: number; options: DrawOptions };

class RecordingTarget implements DrawTarget {
  readonly calls: Call[] = [];
  constructor(readonly width: number, readonly height: number) {}
  clear(color: string) { this.calls.push({ kind: "clear", color }); }
  fillRect(x: number, y: number, w: number, h: number, color: string, alpha = 1) { this.calls.push({ kind: "fill", x, y, w, h, color, alpha }); }
  drawSlice(slice: Slice, x: number, y: number, options: DrawOptions = {}) { this.calls.push({ kind: "slice", slice, x, y, options }); }
  slices() { return this.calls.filter((c): c is Extract<Call, { kind: "slice" }> => c.kind === "slice"); }
}

const actor = (patch: Partial<ActorState> & { id: string; characterId: string }): ActorState => ({
  tier: "common",
  x: 0, y: 0, tileX: 0, tileY: 0,
  facing: 0, hp: 100, maxHp: 100, alive: true, moving: false, diedAtTick: null,
  ...patch,
});

let store: AssetStore;
beforeAll(async () => {
  store = await loadTestAssets();
});

const arena = { width: 24, height: 24 };

describe("ArenaRenderer geometry", () => {
  it("has a fixed logical size of the whole arena plus padding, and a fixed tile mapping", () => {
    const r = new ArenaRenderer(store, { arena });
    expect([r.width, r.height]).toEqual([24 * 16 + 16, 24 * 16 + 16]);
    expect(r.tileToPixel(0, 0)).toEqual({ px: 8, py: 8 });
    expect(r.tileToPixel(23, 5.5)).toEqual({ px: 8 + 23 * 16, py: 8 + 5.5 * 16 });
  });

  it("sorts draw order by y, then x, then id", () => {
    const r = new ArenaRenderer(store, { arena });
    const list = [
      actor({ id: "c", characterId: "Knight", x: 3, y: 2 }),
      actor({ id: "a", characterId: "Knight", x: 5, y: 1 }),
      actor({ id: "b", characterId: "Knight", x: 1, y: 2 }),
      actor({ id: "d", characterId: "Knight", x: 1, y: 2 }),
    ];
    expect(r.drawOrder(list).map((a) => a.id)).toEqual(["a", "b", "d", "c"]);
  });
});

describe("ArenaRenderer drawing", () => {
  it("clears with the flat background, then draws every actor sprite in y order", () => {
    const r = new ArenaRenderer(store, { arena });
    const t = new RecordingTarget(r.width, r.height);
    r.draw(t, { timeMs: 0, actors: [actor({ id: "low", characterId: "Monk", x: 2, y: 9 }), actor({ id: "high", characterId: "Boy", x: 2, y: 3 })] });
    expect(t.calls[0]).toEqual({ kind: "clear", color: PALETTE.background });
    const ys = t.slices().map((s) => s.y);
    expect(ys).toEqual([8 + 3 * 16, 8 + 9 * 16]);
  });

  it("picks idle, walk, attack or dead frames from state and reads facing from the actor", () => {
    const r = new ArenaRenderer(store, { arena, walkFrameMs: 100 });
    const knight = store.actors.get("Knight")!;
    const draw = (a: ActorState, timeMs = 0, fx?: ActorFx) => {
      const t = new RecordingTarget(r.width, r.height);
      r.draw(t, { timeMs, actors: [a], fx: fx ? new Map([[a.id, fx]]) : undefined });
      return t.slices()[0];
    };
    expect(draw(actor({ id: "k", characterId: "Knight", facing: 3 })).slice).toBe(knight.frames.idle[3][0]);
    expect(draw(actor({ id: "k", characterId: "Knight", facing: 1, moving: true }), 250).slice).toBe(knight.frames.walk[1][2]);
    expect(draw(actor({ id: "k", characterId: "Knight", facing: 2 }), 0, { ...NEUTRAL_FX, attacking: true }).slice).toBe(knight.frames.attack[2][0]);
    expect(draw(actor({ id: "k", characterId: "Knight", facing: 0, alive: false, hp: 0 })).slice).toBe(knight.frames.dead[0][0]);
  });

  it("honours Bear's column order and Dragon's hand sliced rects through the store", () => {
    const r = new ArenaRenderer(store, { arena });
    const t = new RecordingTarget(r.width, r.height);
    r.draw(t, { timeMs: 0, actors: [actor({ id: "b", characterId: "Bear", facing: 1, y: 1 }), actor({ id: "d", characterId: "Dragon", facing: 2, y: 2 })] });
    const [bear, dragon] = t.slices();
    expect(bear.slice.sx).toBe(32);
    expect(dragon.slice).toMatchObject({ sx: 32, sy: 0, sw: 16, sh: 16 });
  });

  it("applies sprite local offset, scale, white and alpha from the fx map", () => {
    const r = new ArenaRenderer(store, { arena });
    const t = new RecordingTarget(r.width, r.height);
    const fx: ActorFx = { offsetX: 3, offsetY: -2, scale: 1.15, white: true, alpha: 0.5, attacking: false };
    r.draw(t, { timeMs: 0, actors: [actor({ id: "k", characterId: "Knight", x: 4, y: 4 })], fx: new Map([["k", fx]]) });
    const s = t.slices()[0];
    expect([s.x, s.y]).toEqual([8 + 4 * 16 + 3, 8 + 4 * 16 - 2]);
    expect(s.options).toEqual({ scale: 1.15, white: true, alpha: 0.5 });
  });

  it("draws an hp bar above living actors, tier coloured, proportional to hp, and none for the dead", () => {
    const r = new ArenaRenderer(store, { arena });
    const t = new RecordingTarget(r.width, r.height);
    r.draw(t, { timeMs: 0, actors: [actor({ id: "k", characterId: "Knight", tier: "rare", x: 4, y: 4, hp: 50, maxHp: 100 }), actor({ id: "z", characterId: "Monk", x: 6, y: 6, alive: false, hp: 0 })] });
    const bars = t.calls.filter((c): c is Extract<Call, { kind: "fill" }> => c.kind === "fill" && c.y === 8 + 4 * 16 - 3);
    expect(bars.map((b) => [b.w, b.color])).toEqual([[16, PALETTE.hpBack], [8, PALETTE.hp.rare]]);
    const deadBars = t.calls.filter((c) => c.kind === "fill" && c.y === 8 + 6 * 16 - 3);
    expect(deadBars).toHaveLength(0);
  });

  it("runs the effects callback after every actor", () => {
    const r = new ArenaRenderer(store, { arena });
    const t = new RecordingTarget(r.width, r.height);
    let slicesWhenCalled = -1;
    r.draw(t, { timeMs: 0, actors: [actor({ id: "k", characterId: "Knight" })], drawEffects: () => { slicesWhenCalled = t.slices().length; } });
    expect(slicesWhenCalled).toBe(1);
  });

  it("fails loudly for a character the store does not have", () => {
    const r = new ArenaRenderer(store, { arena });
    const t = new RecordingTarget(r.width, r.height);
    expect(() => r.draw(t, { timeMs: 0, actors: [actor({ id: "x", characterId: "Ghost" })] })).toThrow(/Ghost/);
  });
});
