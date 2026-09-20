// Replayable event log types. The renderer draws four direction sprites, so
// every event carries the facing of the sprite it animates.

export const FACING = { down: 0, up: 1, left: 2, right: 3 } as const;

export type Facing = (typeof FACING)[keyof typeof FACING];

export type EventType = "spawn" | "move" | "attack" | "hit" | "death" | "storm" | "win";

export interface RoundEvent {
  /** Tick. Events sharing a tick are ordered by array position. */
  t: number;
  type: EventType;
  /** Entrant id of the sprite this event animates. */
  actor: string;
  /** Other party, if any: attack target, hit attacker, death killer. */
  target: string | null;
  /** spawn: max hp. move: tiles moved. attack: attack stat. hit and storm: damage. death and win: 0. */
  value: number;
  facing: Facing;
  /** Tile position after the event. Present on spawn and move. */
  x?: number;
  y?: number;
  /** Remaining hp after the event, floored at 0. Present on hit and storm. */
  hp?: number;
}

/** Direction from a displacement. Horizontal wins ties. y grows downward, as on screen. */
export function facingToward(dx: number, dy: number): Facing {
  if (dx === 0 && dy === 0) return FACING.down;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? FACING.right : FACING.left;
  return dy > 0 ? FACING.down : FACING.up;
}

export function isFacing(value: unknown): value is Facing {
  return value === 0 || value === 1 || value === 2 || value === 3;
}
