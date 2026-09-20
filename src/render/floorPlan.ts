// Which floor tile and which scatter detail each arena cell gets.
//
// The arena floor used to be a one pixel grid drawn over a flat fill, which
// reads as graph paper rather than as the bottom of a pit. It is now tiled
// from the pack's own floor sheet, with the detail sheet scattered over it.
//
// The plan is a pure function of the round's seed, not of the frame. The
// floor is redrawn on every frame of the replay, so anything random per call
// would make the whole floor crawl, and this project does not move the
// background under the player.

/**
 * One cell in every DETAIL_IN carries a scatter sprite, on average. At 14 a
 * 24x24 pit held around forty bones and cracks, which reads as a pattern
 * rather than as debris.
 */
export const DETAIL_IN = 26;

export interface FloorCell {
  /** Index into the base tiles the renderer was given. */
  base: number;
  /** Index into the detail sprites, or null for a bare cell. */
  detail: number | null;
}

/** Deterministic 32 bit hash. Same inputs, same cell, every frame. */
function hash(seed: string, x: number, y: number, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= Math.imul(x + 1, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= Math.imul(y + 1, 0x165667b1);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function floorPlan(width: number, height: number, seed: string, baseCount: number, detailCount: number): FloorCell[][] {
  if (width > 0 && height > 0 && baseCount < 1) throw new RangeError("a floor needs at least one base tile");
  const rows: FloorCell[][] = [];
  for (let y = 0; y < height; y++) {
    const row: FloorCell[] = [];
    for (let x = 0; x < width; x++) {
      const base = hash(seed, x, y, 1) % baseCount;
      const scatter = hash(seed, x, y, 2);
      const detail = detailCount > 0 && scatter % DETAIL_IN === 0 ? (hash(seed, x, y, 3) % detailCount) : null;
      row.push({ base, detail });
    }
    rows.push(row);
  }
  return rows;
}
