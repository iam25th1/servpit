// Canvas arena renderer. Fixed camera: the logical picture is the whole
// arena plus padding, drawn at one integer scale by the DrawTarget. There
// is no translate, zoom or scroll anywhere; nothing here can move the
// camera, and DrawTarget exposes no way to.
//
// Every impact effect is sprite local and arrives through ActorFx (offset,
// scale, white flash, alpha) computed by the juice system per frame.

import { WALK_FRAME_MS } from "@/config/playback";
import type { Tier } from "@/config/roster";
import type { Animation, AssetStore, DecodedImage, Slice } from "./assets";
import { GLYPH, clampRun, glyphCell, plateLeft, textWidth } from "./bitmapFont";
import { floorPlan, type FloorCell } from "./floorPlan";
import type { DrawTarget } from "./draw";
import type { ActorState } from "./timeline";

export interface ActorFx {
  /** Sprite local pixel offset. */
  offsetX: number;
  offsetY: number;
  /** Sprite local scale about the sprite centre. */
  scale: number;
  /** Draw the white silhouette this frame. */
  white: boolean;
  alpha: number;
  /** Show the attack pose this frame. */
  attacking: boolean;
}

export const NEUTRAL_FX: Readonly<ActorFx> = Object.freeze({ offsetX: 0, offsetY: 0, scale: 1, white: false, alpha: 1, attacking: false });

/**
 * Cells of tilesetFloor the pit floor is laid from. Four tiles of the sheet's
 * brown stone block, which repeat seamlessly and read as the bottom of a pit
 * rather than as graph paper. Column 22 does not exist: the sheet is 352 px
 * wide, which is 22 columns numbered 0 to 21.
 */
const FLOOR_TILES: readonly (readonly [number, number])[] = [
  [20, 16],
  [21, 16],
  [20, 17],
  [21, 17],
];

/**
 * Cells of tilesetFloorDetail scattered over it: cracks, pebbles, a skull, a
 * bone, a rock. The bones are not decoration for their own sake; this is the
 * floor of a battle royale pit.
 */
const FLOOR_DETAILS: readonly (readonly [number, number])[] = [
  [1, 0],
  [4, 0],
  [5, 0],
  [13, 0],
  [14, 0],
  [15, 0],
];

const TILESET_TILE = 16;

/** The sheet the nameplates are drawn from. */
const NAMEPLATE_FONT = "fontBitmapSmall";

/**
 * Pixels between the top of the health bar and the bottom of the name. The
 * bar occupies the three pixels above the sprite, so this clears it without
 * pushing the name into the fighter standing on the row above.
 */
const NAMEPLATE_GAP = 2;

/** Flat colours only. No purple, no gradients. */
export const PALETTE = {
  background: "#1c1f1a",
  /** Kept for the test that asserts the old hairline grid is gone. */
  grid: "#262a24",
  border: "#3a4035",
  hpBack: "#111311",
  hp: { common: "#7cb342", uncommon: "#42a5f5", rare: "#ffb300" } as Record<Tier, string>,
} as const;

export interface ArenaOptions {
  arena: { width: number; height: number };
  /** Logical pixels per tile. Default 16, the sprite size. */
  tileSize?: number;
  /** Logical pixels of margin around the arena so top row hp bars and offsets stay visible. Default 8. */
  padding?: number;
  /**
   * Milliseconds per walk frame. Defaults to WALK_FRAME_MS, which is derived
   * from the tick: an actor crosses one tile per tick, so a fixed gait would
   * cycle the feet faster than the travel once the tick lengthened.
   */
  walkFrameMs?: number;
  /** Seeds the floor's tile and scatter variation. One floor per round. */
  floorSeed?: string;
}

export interface DrawFrame {
  actors: readonly ActorState[];
  /** Timeline time, used only to pick walk frames. */
  timeMs: number;
  fx?: ReadonlyMap<string, ActorFx>;
  /** Drawn after every actor, on top. */
  drawEffects?: (target: DrawTarget) => void;
}

export class ArenaRenderer {
  readonly width: number;
  readonly height: number;
  private readonly tile: number;
  private readonly padding: number;
  private readonly walkFrameMs: number;
  private readonly arena: { width: number; height: number };
  private seed: string;
  private plan: FloorCell[][];
  private planSeed: string;

  constructor(private readonly store: AssetStore, options: ArenaOptions) {
    this.arena = options.arena;
    this.tile = options.tileSize ?? 16;
    this.padding = options.padding ?? 8;
    this.walkFrameMs = options.walkFrameMs ?? WALK_FRAME_MS;
    this.seed = options.floorSeed ?? "servpit";
    this.planSeed = this.seed;
    this.plan = floorPlan(this.arena.width, this.arena.height, this.seed, FLOOR_TILES.length, FLOOR_DETAILS.length);
    this.width = this.arena.width * this.tile + 2 * this.padding;
    this.height = this.arena.height * this.tile + 2 * this.padding;
  }

  /** The round the floor belongs to. Setting it relays the floor once. */
  get floorSeed(): string {
    return this.seed;
  }

  set floorSeed(seed: string) {
    this.seed = seed;
  }

  tileToPixel(x: number, y: number): { px: number; py: number } {
    return { px: this.padding + x * this.tile, py: this.padding + y * this.tile };
  }

  /** Lower on screen draws later so overlapping sprites layer correctly. Ties by x, then id, for stable order. */
  drawOrder(actors: readonly ActorState[]): ActorState[] {
    return [...actors].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  draw(target: DrawTarget, frame: DrawFrame): void {
    target.clear(PALETTE.background);
    this.drawFloor(target);
    for (const actor of this.drawOrder(frame.actors)) {
      const fx = frame.fx?.get(actor.id) ?? NEUTRAL_FX;
      const slice = this.sliceFor(actor, fx, frame.timeMs);
      const { px, py } = this.tileToPixel(actor.x, actor.y);
      const x = px + fx.offsetX;
      const y = py + fx.offsetY;
      target.drawSlice(slice, x, y, { scale: fx.scale, white: fx.white, alpha: fx.alpha });
      if (actor.alive) this.drawHpBar(target, actor, x, y);
      // After the sprite and the bar, so a fighter drawn later cannot cover
      // a name that belongs to the one in front of it.
      this.drawNameplate(target, actor, x, y, fx.alpha);
    }
    frame.drawEffects?.(target);
  }

  private sliceFor(actor: ActorState, fx: ActorFx, timeMs: number): Slice {
    const sprites = this.store.actors.get(actor.characterId);
    if (!sprites) throw new Error(`no sprites loaded for character ${actor.characterId} (actor ${actor.id})`);
    let animation: Animation;
    let index = 0;
    if (!actor.alive) {
      animation = "dead";
    } else if (fx.attacking) {
      animation = "attack";
    } else if (actor.moving) {
      animation = "walk";
      index = Math.floor(timeMs / this.walkFrameMs);
    } else {
      animation = "idle";
    }
    const frames = sprites.frames[animation][actor.facing];
    return frames[((index % frames.length) + frames.length) % frames.length];
  }

  private drawHpBar(target: DrawTarget, actor: ActorState, x: number, y: number): void {
    const w = this.tile;
    const fill = actor.maxHp > 0 ? Math.max(actor.hp > 0 ? 1 : 0, Math.round((w * actor.hp) / actor.maxHp)) : 0;
    target.fillRect(x, y - 3, w, 2, PALETTE.hpBack);
    if (fill > 0) target.fillRect(x, y - 3, fill, 2, PALETTE.hp[actor.tier]);
  }

  /**
   * The fighter's display name, above its health bar.
   *
   * Canvas text, not DOM text: every glyph is a slice of the pack's 8x8 font
   * sheet drawn on whole pixels, so a name scales with the arena exactly as
   * the fighter does and nothing is antialiased. anime.js never touches this;
   * it is drawn once per frame from the same actor state the sprite is.
   *
   * Two passes. The sheet's own near black ink goes down one pixel right and
   * down as a shadow, then a whitened copy of the same glyph over it. The
   * floor is tiled now and carries bones and pale cracks, so a single tone
   * would disappear over some of it whichever tone it was.
   *
   * Only a named fighter gets one. A house bot has no name beyond its id,
   * and twenty four labels in one arena is noise rather than information.
   */
  private drawNameplate(target: DrawTarget, actor: ActorState, x: number, y: number, alpha: number): void {
    const name = actor.name;
    if (name === null || name.length === 0) return;
    const image = this.store.fonts.get(NAMEPLATE_FONT);
    if (!image) return;

    // Whole pixels throughout: the arena is drawn at a whole number scale and
    // a half pixel here would blur the glyph at every scale above one.
    //
    // Clamped to the canvas, because it clips. A fighter standing against
    // the right wall had the back half of its name cut off, and one on the
    // top row would have had the whole plate above the top edge.
    const width = textWidth(name);
    const left = clampRun(plateLeft(Math.round(x), this.tile, name), width, 0, this.width);
    const top = clampRun(Math.round(y) - 3 - NAMEPLATE_GAP - GLYPH, GLYPH, 0, this.height);

    for (let i = 0; i < name.length; i++) {
      const cell = glyphCell(name[i]);
      if (!cell) continue;
      const slice: Slice = { image, sx: cell.col * GLYPH, sy: cell.row * GLYPH, sw: GLYPH, sh: GLYPH };
      const gx = left + i * GLYPH;
      target.drawSlice(slice, gx + 1, top + 1, { alpha });
      target.drawSlice(slice, gx, top, { alpha, white: true });
    }
  }

  /**
   * The pit floor, tiled from the pack's own sheets. It used to be a one
   * pixel grid over a flat fill, which reads as graph paper.
   *
   * The plan is a pure function of the round's seed, so the floor is laid
   * once and drawn identically on every frame. Varying it per frame would
   * make the whole background crawl under the fighters.
   */
  private drawFloor(target: DrawTarget): void {
    const { px, py } = this.tileToPixel(0, 0);
    const w = this.arena.width * this.tile;
    const h = this.arena.height * this.tile;

    if (this.planSeed !== this.seed) {
      this.plan = floorPlan(this.arena.width, this.arena.height, this.seed, FLOOR_TILES.length, FLOOR_DETAILS.length);
      this.planSeed = this.seed;
    }

    const floor = this.store.tilesets.get("tilesetFloor");
    const detail = this.store.tilesets.get("tilesetFloorDetail");
    if (floor) {
      const cell = (image: DecodedImage, col: number, row: number): Slice => ({
        image,
        sx: col * TILESET_TILE,
        sy: row * TILESET_TILE,
        sw: TILESET_TILE,
        sh: TILESET_TILE,
      });
      for (let j = 0; j < this.arena.height; j++) {
        for (let i = 0; i < this.arena.width; i++) {
          const spec = this.plan[j][i];
          const [bc, br] = FLOOR_TILES[spec.base];
          target.drawSlice(cell(floor, bc, br), px + i * this.tile, py + j * this.tile);
          if (spec.detail !== null && detail) {
            const [dc, dr] = FLOOR_DETAILS[spec.detail];
            target.drawSlice(cell(detail, dc, dr), px + i * this.tile, py + j * this.tile);
          }
        }
      }
    }
    target.fillRect(px - 1, py - 1, w + 2, 1, PALETTE.border);
    target.fillRect(px - 1, py + h, w + 2, 1, PALETTE.border);
    target.fillRect(px - 1, py - 1, 1, h + 2, PALETTE.border);
    target.fillRect(px + w, py - 1, 1, h + 2, PALETTE.border);
  }
}
