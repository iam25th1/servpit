// Slot cabinet renderer. Draws into the same DrawTarget the arena uses, so
// the one integer scale and imageSmoothingEnabled false carry over and the
// camera still cannot move.
//
// The smear is the only trick here: while a reel moves, each symbol is drawn
// several times along the direction of travel at falling alpha, spaced by the
// distance the reel covers in a frame. That is a sprite offset, so it stays
// crisp pixel art. No blur filter, no canvas filter, nothing that would make
// the frame soft.

import type { AssetStore } from "../assets";
import type { DrawTarget } from "../draw";
import { SLOT_LAYOUT, paylineY, reelX, type SlotLayout } from "./layout";
import type { ReelState } from "./reels";

/** Flat colours only. No purple, no gradients. */
export const SLOT_PALETTE = {
  cabinet: "#1c1f1a",
  window: "#11140f",
  frame: "#3a4035",
  payline: "#ffb300",
  divider: "#262a24",
  bulbOn: "#ffd54f",
  bulbOff: "#4a4f44",
  lever: "#8a8f88",
  leverKnob: "#e53935",
} as const;

export interface SlotFrame {
  reels: readonly ReelState[];
  /** Milliseconds from the shared clock, for the bulb chase. */
  timeMs: number;
  /** Lever travel, 0 at rest to 1 fully down. */
  leverProgress?: number;
  /** Drawn after the cabinet, on top: rings, particles, sweeps. */
  drawEffects?: (target: DrawTarget) => void;
  /** Bulb chase runs backwards on a win. */
  bulbsReversed?: boolean;
  /** Reels highlighted because they are part of a match. */
  highlight?: readonly number[];
}

/** Copies drawn per cell at full speed. One means no smear. */
const MAX_SMEAR = 5;

export class SlotRenderer {
  readonly width: number;
  readonly height: number;

  constructor(
    private readonly store: AssetStore,
    private readonly layout: SlotLayout = SLOT_LAYOUT,
  ) {
    this.width = layout.width;
    this.height = layout.height;
  }

  draw(target: DrawTarget, frame: SlotFrame): void {
    target.clear(SLOT_PALETTE.cabinet);
    this.drawBulbs(target, frame);
    this.drawWindow(target);
    for (const reel of frame.reels) this.drawReel(target, reel, frame);
    this.drawPayline(target);
    this.drawLever(target, frame.leverProgress ?? 0);
    frame.drawEffects?.(target);
  }

  private drawWindow(target: DrawTarget): void {
    const w = this.layout.window;
    target.fillRect(w.x, w.y, w.width, w.height, SLOT_PALETTE.window);
    target.fillRect(w.x - 1, w.y - 1, w.width + 2, 1, SLOT_PALETTE.frame);
    target.fillRect(w.x - 1, w.y + w.height, w.width + 2, 1, SLOT_PALETTE.frame);
    target.fillRect(w.x - 1, w.y - 1, 1, w.height + 2, SLOT_PALETTE.frame);
    target.fillRect(w.x + w.width, w.y - 1, 1, w.height + 2, SLOT_PALETTE.frame);
    for (let i = 1; i < 3; i++) {
      const x = reelX(this.layout, i) - this.layout.reel.gap / 2;
      target.fillRect(x, w.y, 1, w.height, SLOT_PALETTE.divider);
    }
  }

  private drawReel(target: DrawTarget, reel: ReelState, frame: SlotFrame): void {
    const cell = this.layout.cell.size;
    const w = this.layout.window;
    const x = reelX(this.layout, reel.index) + (this.layout.reel.width - cell) / 2;
    const centreY = paylineY(this.layout) - cell / 2;

    // Copies and spacing both scale with speed, so a slow reel smears less.
    const symbolsPerFrame = (reel.speed * 16) / 1000;
    const copies = reel.stopped ? 1 : Math.max(1, Math.min(MAX_SMEAR, 1 + Math.round(symbolsPerFrame * 2)));
    const spacing = copies > 1 ? (symbolsPerFrame * cell) / copies : 0;

    for (const visible of reel.window) {
      const sprites = this.store.actors.get(visible.symbol);
      if (!sprites) continue;
      const baseY = centreY + visible.row * cell;
      for (let copy = 0; copy < copies; copy++) {
        const y = baseY - copy * spacing;
        if (y + cell < w.y || y > w.y + w.height) continue;
        target.drawSlice(sprites.faceset, x, y, { alpha: copy === 0 ? 1 : 0.45 * (1 - copy / copies) });
      }
    }

    if (frame.highlight?.includes(reel.index)) {
      target.fillRect(x - 2, centreY - 2, cell + 4, 1, SLOT_PALETTE.payline);
      target.fillRect(x - 2, centreY + cell + 1, cell + 4, 1, SLOT_PALETTE.payline);
    }
  }

  private drawPayline(target: DrawTarget): void {
    const w = this.layout.window;
    const y = paylineY(this.layout);
    target.fillRect(w.x, y, 3, 1, SLOT_PALETTE.payline, 0.8);
    target.fillRect(w.x + w.width - 3, y, 3, 1, SLOT_PALETTE.payline, 0.8);
  }

  private drawLever(target: DrawTarget, progress: number): void {
    const l = this.layout.lever;
    const travel = Math.max(0, Math.min(1, progress)) * l.travel;
    target.fillRect(l.x - 1, l.y, 2, l.travel + l.knobRadius, SLOT_PALETTE.frame);
    target.fillRect(l.x - 1, l.y + travel, 2, l.travel - travel, SLOT_PALETTE.lever);
    const knobY = l.y + travel;
    for (let dy = -l.knobRadius; dy <= l.knobRadius; dy++) {
      const half = Math.floor(Math.sqrt(l.knobRadius * l.knobRadius - dy * dy));
      target.fillRect(l.x - half, knobY + dy, half * 2 + 1, 1, SLOT_PALETTE.leverKnob);
    }
  }

  private drawBulbs(target: DrawTarget, frame: SlotFrame): void {
    const b = this.layout.bulbs;
    const inset = b.inset;
    const w = this.width - inset * 2;
    const h = this.height - inset * 2;
    const perimeter = 2 * (w + h);
    const direction = frame.bulbsReversed ? -1 : 1;
    for (let i = 0; i < b.count; i++) {
      const along = (i / b.count) * perimeter;
      let x = inset;
      let y = inset;
      if (along < w) x = inset + along;
      else if (along < w + h) {
        x = inset + w;
        y = inset + (along - w);
      } else if (along < w * 2 + h) {
        x = inset + w - (along - w - h);
        y = inset + h;
      } else y = inset + h - (along - w * 2 - h);
      // Phase offset sine on alpha only: nothing moves, the light travels.
      const phase = (frame.timeMs / 900) * Math.PI * 2 * direction + (i / b.count) * Math.PI * 4;
      const lit = (Math.sin(phase) + 1) / 2;
      target.fillRect(Math.round(x) - b.radius, Math.round(y) - b.radius, b.radius * 2, b.radius * 2, lit > 0.5 ? SLOT_PALETTE.bulbOn : SLOT_PALETTE.bulbOff, 0.35 + lit * 0.65);
    }
  }
}
