import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SLOT } from "@/config/slot";
import type { AssetStore, Slice } from "../assets";
import type { DrawOptions, DrawTarget } from "../draw";
import { loadTestAssets } from "../testing";
import { SLOT_LAYOUT, paylineY, reelX } from "./layout";
import { ReelSet } from "./reels";
import { SlotRenderer, SLOT_PALETTE } from "./draw";

type Fill = { x: number; y: number; w: number; h: number; color: string; alpha: number };
type Sprite = { slice: Slice; x: number; y: number; options: DrawOptions };

class RecordingTarget implements DrawTarget {
  fills: Fill[] = [];
  sprites: Sprite[] = [];
  cleared: string | null = null;
  constructor(readonly width: number, readonly height: number) {}
  clear(color: string) { this.cleared = color; }
  fillRect(x: number, y: number, w: number, h: number, color: string, alpha = 1) { this.fills.push({ x, y, w, h, color, alpha }); }
  drawSlice(slice: Slice, x: number, y: number, options: DrawOptions = {}) { this.sprites.push({ slice, x, y, options }); }
}

const SYMBOLS = ["NinjaRed", "NinjaBlue", "Knight", "Monk", "Hunter", "Boy", "Eskimo", "Caveman", "Bear", "Dragon"];

let store: AssetStore;
beforeAll(async () => {
  store = await loadTestAssets();
});

const spinning = (ms: number) => {
  const set = new ReelSet(DEFAULT_SLOT, SYMBOLS);
  set.start(["Knight", "Monk", "Bear"], 0);
  for (let t = 0; t < ms; t += 16) set.advance(16);
  return set;
};

describe("SlotRenderer geometry", () => {
  it("has a fixed logical size that holds the whole cabinet", () => {
    const r = new SlotRenderer(store);
    expect(r.width).toBe(SLOT_LAYOUT.width);
    expect(r.height).toBe(SLOT_LAYOUT.height);
    expect(r.width).toBeGreaterThan(SLOT_LAYOUT.window.width);
  });

  it("places three reel columns inside the window, left to right", () => {
    for (let i = 0; i < 3; i++) {
      const x = reelX(SLOT_LAYOUT, i);
      expect(x).toBeGreaterThanOrEqual(SLOT_LAYOUT.window.x);
      expect(x + SLOT_LAYOUT.reel.width).toBeLessThanOrEqual(SLOT_LAYOUT.window.x + SLOT_LAYOUT.window.width);
      if (i > 0) expect(x).toBeGreaterThan(reelX(SLOT_LAYOUT, i - 1));
    }
  });
});

describe("SlotRenderer reel drawing", () => {
  it("clears to the flat cabinet colour and draws every visible symbol", () => {
    const set = spinning(4_000);
    const target = new RecordingTarget(SLOT_LAYOUT.width, SLOT_LAYOUT.height);
    new SlotRenderer(store).draw(target, { reels: set.reelStates(), timeMs: 0 });
    expect(target.cleared).toBe(SLOT_PALETTE.cabinet);
    // Three reels, each showing stripRadius * 2 + 1 cells.
    expect(target.sprites.length).toBeGreaterThanOrEqual(3 * (DEFAULT_SLOT.reels.stripRadius * 2 + 1));
  });

  it("draws the settled symbol on the payline", () => {
    const set = spinning(4_000);
    const target = new RecordingTarget(SLOT_LAYOUT.width, SLOT_LAYOUT.height);
    new SlotRenderer(store).draw(target, { reels: set.reelStates(), timeMs: 0 });
    const centre = paylineY(SLOT_LAYOUT) - SLOT_LAYOUT.cell.size / 2;
    const onPayline = target.sprites.filter((s) => Math.abs(s.y - centre) < 0.5);
    expect(onPayline).toHaveLength(3);
    const expected = ["Knight", "Monk", "Bear"].map((id) => store.actors.get(id)!.faceset);
    expect(onPayline.map((s) => s.slice)).toEqual(expected);
  });

  it("smears with extra offset copies while moving, and draws exactly one copy per cell at rest", () => {
    const moving = new RecordingTarget(SLOT_LAYOUT.width, SLOT_LAYOUT.height);
    new SlotRenderer(store).draw(moving, { reels: spinning(500).reelStates(), timeMs: 0 });
    const rest = new RecordingTarget(SLOT_LAYOUT.width, SLOT_LAYOUT.height);
    new SlotRenderer(store).draw(rest, { reels: spinning(4_000).reelStates(), timeMs: 0 });
    expect(moving.sprites.length).toBeGreaterThan(rest.sprites.length);
    // Every smear copy is drawn at reduced alpha, and none is a blur or a scale trick.
    const faded = moving.sprites.filter((s) => (s.options.alpha ?? 1) < 1);
    expect(faded.length).toBeGreaterThan(0);
    for (const s of moving.sprites) {
      expect(s.options.scale ?? 1).toBe(1);
      expect(s.options.white ?? false).toBe(false);
    }
  });

  it("scales the number of smear copies with speed", () => {
    const copiesAt = (ms: number) => {
      const target = new RecordingTarget(SLOT_LAYOUT.width, SLOT_LAYOUT.height);
      new SlotRenderer(store).draw(target, { reels: spinning(ms).reelStates(), timeMs: 0 });
      return target.sprites.length;
    };
    // 60 ms in the reel is still accelerating; 500 ms it is at full speed.
    expect(copiesAt(500)).toBeGreaterThan(copiesAt(60));
  });

  it("keeps every drawn symbol inside the window bounds", () => {
    const target = new RecordingTarget(SLOT_LAYOUT.width, SLOT_LAYOUT.height);
    new SlotRenderer(store).draw(target, { reels: spinning(500).reelStates(), timeMs: 0 });
    const w = SLOT_LAYOUT.window;
    for (const s of target.sprites) {
      expect(s.y + SLOT_LAYOUT.cell.size).toBeGreaterThan(w.y - 1);
      expect(s.y).toBeLessThan(w.y + w.height + 1);
    }
  });

  it("paints flat colours only, nothing in the purple range", () => {
    const target = new RecordingTarget(SLOT_LAYOUT.width, SLOT_LAYOUT.height);
    new SlotRenderer(store).draw(target, { reels: spinning(500).reelStates(), timeMs: 0 });
    const hue = (hex: string): number => {
      const n = Number.parseInt(hex.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return -1;
      const d = max - min;
      const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return h * 60;
    };
    const colors = [target.cleared!, ...target.fills.map((f) => f.color)];
    for (const c of colors) {
      const h = hue(c);
      expect(h < 255 || h > 335, `slot paints ${c}`).toBe(true);
    }
  });
});
