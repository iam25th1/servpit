// Which symbol is under the pointer.
//
// The reels are drawn on a canvas, so a symbol is not an element and cannot
// carry a tooltip of its own. This turns a point on the canvas back into the
// symbol drawn there, using the same layout the renderer draws from, so the
// answer cannot drift from what is on screen.
//
// Pure, and the pointer is given in logical pixels: the caller scales from
// the element's box, because only the caller knows how big the canvas is on
// this screen.

import { paylineY, reelX, type SlotLayout } from "./layout";
import type { ReelState } from "./reels";

/** The symbol drawn at this point, or null when the point is not on one. */
export function symbolAtPoint(layout: SlotLayout, reels: readonly ReelState[], x: number, y: number): string | null {
  const cell = layout.cell.size;
  const window = layout.window;
  if (x < window.x || x > window.x + window.width || y < window.y || y > window.y + window.height) return null;

  for (const reel of reels) {
    const left = reelX(layout, reel.index) + (layout.reel.width - cell) / 2;
    if (x < left || x > left + cell) continue;
    const centreY = paylineY(layout) - cell / 2;
    for (const visible of reel.window) {
      const top = centreY + visible.row * cell;
      if (y >= top && y <= top + cell) return visible.symbol;
    }
    return null;
  }
  return null;
}
