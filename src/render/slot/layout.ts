// Fixed cabinet geometry in logical pixels. The camera never moves: the whole
// cabinet is always on screen, scaled by one integer factor like the arena.

export interface SlotLayout {
  width: number;
  height: number;
  /** Reel window, the lit area symbols scroll through. */
  window: { x: number; y: number; width: number; height: number };
  /** One reel column. */
  reel: { width: number; gap: number };
  /** Symbol cell, matching the 38x38 facesets. */
  cell: { size: number };
  lever: { x: number; y: number; travel: number; knobRadius: number; rodWidth: number };
  /** Bulbs run around the cabinet edge. */
  bulbs: { count: number; radius: number; inset: number };
}

const CELL = 38;
const REEL_WIDTH = CELL + 10;
const GAP = 8;
const WINDOW_ROWS = 3;

const windowWidth = REEL_WIDTH * 3 + GAP * 2;
const windowHeight = CELL * WINDOW_ROWS;
const PAD_X = 22;
const PAD_TOP = 26;
const PAD_BOTTOM = 30;
const LEVER_COLUMN = 44;

export const SLOT_LAYOUT: SlotLayout = {
  width: PAD_X * 2 + windowWidth + LEVER_COLUMN,
  height: PAD_TOP + windowHeight + PAD_BOTTOM,
  window: { x: PAD_X, y: PAD_TOP, width: windowWidth, height: windowHeight },
  reel: { width: REEL_WIDTH, gap: GAP },
  cell: { size: CELL },
  // The ball is 21 logical pixels across against a 38 pixel symbol cell, so
  // it reads as a lever rather than as a dot. The column widened to hold it.
  lever: { x: PAD_X + windowWidth + LEVER_COLUMN / 2, y: PAD_TOP + 12, travel: 44, knobRadius: 10, rodWidth: 5 },
  bulbs: { count: 28, radius: 2, inset: 6 },
};

/** Left edge of a reel column, in logical pixels. */
export function reelX(layout: SlotLayout, index: number): number {
  return layout.window.x + index * (layout.reel.width + layout.reel.gap);
}

/** Centre y of the payline row. */
export function paylineY(layout: SlotLayout): number {
  return layout.window.y + layout.window.height / 2;
}
