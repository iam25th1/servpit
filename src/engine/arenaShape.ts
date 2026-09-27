// The shape of the pit floor.
//
// A square pit is every tile of the grid. A round pit is the tiles whose
// centres fall inside the ellipse the grid is drawn around, which on a square
// grid is a circle: a colosseum floor, with stands where the corners were.
//
// Integer only, like the rest of the engine, so a round replays the same on
// every machine. With the centre of tile (x, y) at (x + 1/2, y + 1/2) and the
// grid's centre at (w/2, h/2), doubling both sides gives whole numbers:
//   dx = 2x + 1 - w,  dy = 2y + 1 - h
// and the tile is on the floor when (dx/w)^2 + (dy/h)^2 <= 1, which is
//   dx^2 * h^2 + dy^2 * w^2 <= w^2 * h^2.

export type ArenaShape = "square" | "round";

export interface Arena {
  width: number;
  height: number;
  /** Square when left out, which is every grid made before the round pit. */
  shape?: ArenaShape;
}

/** True when this tile is floor a fighter may stand on. */
export function inArena(arena: Arena, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= arena.width || y >= arena.height) return false;
  if (arena.shape !== "round") return true;
  const w = arena.width;
  const h = arena.height;
  const dx = 2 * x + 1 - w;
  const dy = 2 * y + 1 - h;
  return dx * dx * h * h + dy * dy * w * w <= w * w * h * h;
}

/** Every floor tile as y * width + x, in reading order. */
export function arenaTiles(arena: Arena): number[] {
  const tiles: number[] = [];
  for (let y = 0; y < arena.height; y++) {
    for (let x = 0; x < arena.width; x++) if (inArena(arena, x, y)) tiles.push(y * arena.width + x);
  }
  return tiles;
}
