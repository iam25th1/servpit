// Asset loader: decodes every sheet once, slices frames per facing, and
// keeps a white silhouette of each sheet for hit flashes. Image decoding is
// injected (ImageLoader) so this module has no DOM dependency and the
// slicing rules are unit tested against the committed manifest.
//
// Pack quirks handled here, on purpose and visibly (see ActorSprites.notes):
//   NinjaFire, NinjaWater: no Idle.png, idle pose is walk frame 0.
//   Bear: facingColumns [0, 2, 1, 3] is honoured through the manifest.
//   Dragon: facingColumns null, frames come from the hand sliced frameRects.
// Anything missing or mis sized throws an AssetError at load. Nothing is
// allowed to render as a blank square.

import type { Tier } from "@/config/roster";
import type { Facing } from "@/engine/events";
import { FACING_NAMES, type FrameRect, type FxDef, type Manifest, type ManifestEntry, type SpriteSheetDef } from "./manifest";

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** ImageBitmap or canvas in the browser, anything in tests. */
  readonly source: unknown;
}

export interface ImageLoader {
  load(path: string): Promise<DecodedImage>;
  /** Same size image with every opaque pixel painted white. */
  whiten(image: DecodedImage): DecodedImage;
}

export interface Slice {
  readonly image: DecodedImage;
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

export type Animation = "idle" | "walk" | "attack" | "dead";
export const ANIMATIONS: readonly Animation[] = ["idle", "walk", "attack", "dead"];

export interface ActorSprites {
  id: string;
  tier: Tier;
  /** frames[animation][facing][frameIndex] */
  frames: Record<Animation, Slice[][]>;
  /** Portrait, used as the slot machine symbol. */
  faceset: Slice;
  /** Quirks applied while loading this actor. */
  notes: string[];
}

export interface FxSprites {
  id: string;
  group: string;
  frameWidth: number;
  frameHeight: number;
  frames: Slice[];
}

export interface AssetStore {
  actors: Map<string, ActorSprites>;
  fx: Map<string, FxSprites>;
  whiteOf(image: DecodedImage): DecodedImage;
}

export class AssetError extends Error {}

const FACINGS: readonly Facing[] = [0, 1, 2, 3];

async function decode(loader: ImageLoader, path: string, label: string): Promise<DecodedImage> {
  let image: DecodedImage;
  try {
    image = await loader.load(path);
  } catch (e) {
    throw new AssetError(`${label}: failed to decode ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1) {
    throw new AssetError(`${label}: decoded ${path} has no size`);
  }
  return image;
}

function checkGrid(image: DecodedImage, def: { cols: number; rows: number; frameWidth: number; frameHeight: number }, label: string): void {
  const w = def.cols * def.frameWidth;
  const h = def.rows * def.frameHeight;
  if (image.width !== w || image.height !== h) {
    throw new AssetError(`${label}: sheet is ${image.width}x${image.height}, manifest grid expects ${w}x${h}`);
  }
}

function slice(image: DecodedImage, r: FrameRect, label: string): Slice {
  if (r.x < 0 || r.y < 0 || r.x + r.w > image.width || r.y + r.h > image.height) {
    throw new AssetError(`${label}: frame rect ${JSON.stringify(r)} falls outside the ${image.width}x${image.height} sheet`);
  }
  return { image, sx: r.x, sy: r.y, sw: r.w, sh: r.h };
}

/** [facing][frame] for a sheet whose columns are facings and rows are frames, or whose frameRects say otherwise. */
function facingFrames(image: DecodedImage, def: SpriteSheetDef, label: string): Slice[][] {
  if (def.frameRects) {
    const rects = def.frameRects;
    return FACINGS.map((facing) => rects[FACING_NAMES[facing]].map((r) => slice(image, r, label)));
  }
  const columns = def.facingColumns;
  if (columns === null) throw new AssetError(`${label}: neither facingColumns nor frameRects`);
  return FACINGS.map((facing) =>
    Array.from({ length: def.rows }, (_, row) =>
      slice(image, { x: columns[facing] * def.frameWidth, y: row * def.frameHeight, w: def.frameWidth, h: def.frameHeight }, label),
    ),
  );
}

const firstFrames = (frames: Slice[][]): Slice[][] => frames.map((perFacing) => [perFacing[0]]);

async function loadActor(entry: ManifestEntry, loader: ImageLoader, remember: (img: DecodedImage) => void): Promise<ActorSprites> {
  const notes: string[] = [];
  const sheets = new Map<string, { image: DecodedImage; def: SpriteSheetDef }>();
  await Promise.all(
    Object.entries(entry.sprites).map(async ([name, def]) => {
      const label = `${entry.id} ${name}`;
      const image = await decode(loader, def.path, label);
      checkGrid(image, def, label);
      remember(image);
      sheets.set(name, { image, def });
    }),
  );
  const framesOf = (name: string): Slice[][] => {
    const s = sheets.get(name);
    if (!s) throw new AssetError(`${entry.id}: manifest has no ${name} sheet`);
    return facingFrames(s.image, s.def, `${entry.id} ${name}`);
  };

  const facesetImage = await decode(loader, entry.facesetPath, `${entry.id} faceset`);
  remember(facesetImage);
  const faceset = slice(facesetImage, { x: 0, y: 0, w: facesetImage.width, h: facesetImage.height }, `${entry.id} faceset`);

  let frames: Record<Animation, Slice[][]>;
  if (sheets.has("sheet")) {
    const all = framesOf("sheet");
    frames = { walk: all, idle: firstFrames(all), attack: firstFrames(all), dead: firstFrames(all) };
    notes.push(`${entry.id}: single monster sheet, idle and attack use walk frame 0, no dead pose (renderer fades the last frame)`);
  } else {
    const walk = framesOf("walk");
    let idle: Slice[][];
    if (sheets.has("idle")) {
      idle = framesOf("idle");
    } else {
      idle = firstFrames(walk);
      notes.push(`${entry.id}: no idle sheet in the pack, walk frame 0 is the idle pose`);
    }
    frames = { idle, walk, attack: framesOf("attack"), dead: framesOf("dead") };
  }
  for (const anim of ANIMATIONS) {
    for (const facing of FACINGS) {
      if (frames[anim][facing].length < 1) throw new AssetError(`${entry.id} ${anim}: no frames for facing ${facing}`);
    }
  }
  return { id: entry.id, tier: entry.tier, frames, faceset, notes };
}

async function loadFx(def: FxDef, loader: ImageLoader, remember: (img: DecodedImage) => void): Promise<FxSprites> {
  const label = `fx ${def.id}`;
  const image = await decode(loader, def.path, label);
  checkGrid(image, def, label);
  remember(image);
  const frames: Slice[] = [];
  for (let row = 0; row < def.rows; row++) {
    for (let col = 0; col < def.cols; col++) {
      frames.push(slice(image, { x: col * def.frameWidth, y: row * def.frameHeight, w: def.frameWidth, h: def.frameHeight }, label));
    }
  }
  return { id: def.id, group: def.group, frameWidth: def.frameWidth, frameHeight: def.frameHeight, frames };
}

export async function loadAssets(manifest: Manifest, loader: ImageLoader): Promise<AssetStore> {
  const whites = new Map<DecodedImage, DecodedImage>();
  const remember = (img: DecodedImage): void => {
    if (!whites.has(img)) whites.set(img, loader.whiten(img));
  };
  const [actorList, fxList] = await Promise.all([
    Promise.all(manifest.entries.map((e) => loadActor(e, loader, remember))),
    Promise.all(manifest.fx.map((f) => loadFx(f, loader, remember))),
  ]);
  return {
    actors: new Map(actorList.map((a) => [a.id, a])),
    fx: new Map(fxList.map((f) => [f.id, f])),
    whiteOf(image) {
      let w = whites.get(image);
      if (!w) {
        w = loader.whiten(image);
        whites.set(image, w);
      }
      return w;
    },
  };
}
