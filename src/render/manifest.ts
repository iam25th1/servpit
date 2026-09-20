// Parses public/assets/manifest.json into a typed, validated structure.
// The manifest is data fetched by the browser, so every field is checked
// and a bad or missing field fails here with a path, never later as a
// blank sprite.

import { TIERS, type Tier } from "@/config/roster";

export type FacingName = "down" | "up" | "left" | "right";
export const FACING_NAMES: readonly FacingName[] = ["down", "up", "left", "right"];

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteSheetDef {
  path: string;
  frameWidth: number;
  frameHeight: number;
  cols: number;
  rows: number;
  /** Sheet column per facing value, or null when frameRects carries the slicing. */
  facingColumns: readonly [number, number, number, number] | null;
  frameRects?: Record<FacingName, FrameRect[]>;
}

export interface ManifestEntry {
  id: string;
  tier: Tier;
  sourceFolder: string;
  facesetPath: string;
  sprites: Record<string, SpriteSheetDef>;
}

export interface FxDef {
  id: string;
  group: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
  cols: number;
  rows: number;
}

export interface Manifest {
  source: string;
  pack: string;
  frame: { width: number; height: number };
  faceset: { width: number; height: number };
  facingOrder: FacingName[];
  entries: ManifestEntry[];
  fx: FxDef[];
  warnings: string[];
}

const ASSET_PATH = /^\/assets\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.png$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function fail(path: string, message: string): never {
  throw new Error(`manifest ${path}: ${message}`);
}

function str(v: unknown, path: string): string {
  if (typeof v !== "string" || v.length < 1) fail(path, "must be a non empty string");
  return v;
}

function posInt(v: unknown, path: string, min = 1): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min) fail(path, `must be an integer >= ${min}`);
  return v;
}

function assetPath(v: unknown, path: string): string {
  const s = str(v, path);
  if (!ASSET_PATH.test(s)) fail(path, `must be a same origin /assets/... png path, got ${s}`);
  return s;
}

function rect(v: unknown, path: string): FrameRect {
  if (!isObject(v)) fail(path, "must be an object");
  return { x: posInt(v.x, `${path}.x`, 0), y: posInt(v.y, `${path}.y`, 0), w: posInt(v.w, `${path}.w`), h: posInt(v.h, `${path}.h`) };
}

function sheet(v: unknown, path: string): SpriteSheetDef {
  if (!isObject(v)) fail(path, "must be an object");
  const def: SpriteSheetDef = {
    path: assetPath(v.path, `${path}.path`),
    frameWidth: posInt(v.frameWidth, `${path}.frameWidth`),
    frameHeight: posInt(v.frameHeight, `${path}.frameHeight`),
    cols: posInt(v.cols, `${path}.cols`),
    rows: posInt(v.rows, `${path}.rows`),
    facingColumns: null,
  };
  if (v.facingColumns === null) {
    if (!isObject(v.frameRects)) fail(`${path}.frameRects`, "required when facingColumns is null");
    const rects = {} as Record<FacingName, FrameRect[]>;
    for (const name of FACING_NAMES) {
      const list = v.frameRects[name];
      if (!Array.isArray(list) || list.length < 1) fail(`${path}.frameRects.${name}`, "must be a non empty array");
      rects[name] = list.map((r, i) => rect(r, `${path}.frameRects.${name}[${i}]`));
    }
    def.frameRects = rects;
  } else {
    const cols = v.facingColumns;
    if (!Array.isArray(cols) || cols.length !== 4 || cols.some((c) => !Number.isSafeInteger(c) || c < 0 || c >= def.cols)) {
      fail(`${path}.facingColumns`, `must be four column indexes below ${def.cols}, or null with frameRects`);
    }
    def.facingColumns = [cols[0], cols[1], cols[2], cols[3]];
  }
  return def;
}

function entry(v: unknown, index: number): ManifestEntry {
  if (!isObject(v)) fail(`entries[${index}]`, "must be an object");
  const id = str(v.id, `entries[${index}].id`);
  const path = `entries[${id}]`;
  if (!TIERS.includes(v.tier as Tier)) fail(`${path}.tier`, `must be one of ${TIERS.join(", ")}`);
  if (!isObject(v.sprites) || Object.keys(v.sprites).length < 1) fail(`${path}.sprites`, "must be a non empty object");
  const sprites: Record<string, SpriteSheetDef> = {};
  for (const [name, def] of Object.entries(v.sprites)) sprites[name] = sheet(def, `${path}.sprites.${name}`);
  return {
    id,
    tier: v.tier as Tier,
    sourceFolder: str(v.sourceFolder, `${path}.sourceFolder`),
    facesetPath: assetPath(v.facesetPath, `${path}.facesetPath`),
    sprites,
  };
}

function fx(v: unknown, index: number): FxDef {
  const path = `fx[${index}]`;
  if (!isObject(v)) fail(path, "must be an object");
  return {
    id: str(v.id, `${path}.id`),
    group: str(v.group, `${path}.group`),
    path: assetPath(v.path, `${path}.path`),
    frameWidth: posInt(v.frameWidth, `${path}.frameWidth`),
    frameHeight: posInt(v.frameHeight, `${path}.frameHeight`),
    cols: posInt(v.cols, `${path}.cols`),
    rows: posInt(v.rows, `${path}.rows`),
  };
}

function size(v: unknown, path: string): { width: number; height: number } {
  if (!isObject(v)) fail(path, "must be an object");
  return { width: posInt(v.width, `${path}.width`), height: posInt(v.height, `${path}.height`) };
}

export function parseManifest(json: unknown): Manifest {
  if (!isObject(json)) fail("", "manifest must be an object");
  const facingOrder = json.facingOrder;
  if (!Array.isArray(facingOrder) || facingOrder.join(",") !== FACING_NAMES.join(",")) {
    fail("facingOrder", `must be ${FACING_NAMES.join(", ")}`);
  }
  if (!Array.isArray(json.entries) || json.entries.length < 1) fail("entries", "must be a non empty array");
  if (!Array.isArray(json.fx)) fail("fx", "must be an array");
  if (!Array.isArray(json.warnings) || json.warnings.some((w) => typeof w !== "string")) fail("warnings", "must be an array of strings");

  const entries = json.entries.map(entry);
  if (new Set(entries.map((e) => e.id)).size !== entries.length) fail("entries", "ids must be unique");
  const fxList = json.fx.map(fx);
  if (new Set(fxList.map((f) => f.id)).size !== fxList.length) fail("fx", "ids must be unique");

  return {
    source: str(json.source, "source"),
    pack: str(json.pack, "pack"),
    frame: size(json.frame, "frame"),
    faceset: size(json.faceset, "faceset"),
    facingOrder: [...FACING_NAMES],
    entries,
    fx: fxList,
    warnings: json.warnings as string[],
  };
}
