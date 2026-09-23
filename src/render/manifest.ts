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

export interface ManifestPortrait {
  id: string;
  sourceFolder: string;
  facesetPath: string;
  width: number;
  height: number;
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

export interface AudioDef {
  id: string;
  path: string;
  loop: boolean;
}

export type UiKind = "ninePatch" | "sprite" | "tileset" | "font";

export interface UiDef {
  id: string;
  kind: UiKind;
  path: string;
  width: number;
  height: number;
  /** Nine patch inset in pixels. Present only on a nine patch. */
  slice?: { x: number; y: number };
  /** Tile size. Present only on a tileset. */
  tile?: number;
}

export interface Manifest {
  source: string;
  pack: string;
  frame: { width: number; height: number };
  faceset: { width: number; height: number };
  facingOrder: FacingName[];
  entries: ManifestEntry[];
  /** Faces with no fighter behind them. Marrow is the only one. */
  portraits?: ManifestPortrait[];
  fx: FxDef[];
  audio: AudioDef[];
  ui: UiDef[];
  /** Emote id by the meaning this app assigns it. */
  emotes: Record<string, string>;
  /** Mode icon id by mode. */
  modeIcons: Record<string, string>;
  warnings: string[];
}

const ASSET_PATH = /^\/assets\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.png$/;
// Wav for the cues and ogg for the two music beds: a three minute loop as
// wav is tens of megabytes served to every visitor. Same origin either way,
// which is the part that matters.
const AUDIO_PATH = /^\/assets\/audio\/[A-Za-z0-9_-]+\.(wav|ogg)$/;
const UI_PATH = /^\/assets\/ui\/[A-Za-z0-9_-]+\.(png|ttf)$/;
const UI_KINDS: readonly UiKind[] = ["ninePatch", "sprite", "tileset", "font"];

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

function audio(v: unknown, index: number): AudioDef {
  const path = `audio[${index}]`;
  if (!isObject(v)) fail(path, "must be an object");
  const file = str(v.path, `${path}.path`);
  if (!AUDIO_PATH.test(file)) fail(`${path}.path`, `must be a same origin /assets/audio wav or ogg path, got ${file}`);
  if (typeof v.loop !== "boolean") fail(`${path}.loop`, "must be a boolean");
  return { id: str(v.id, `${path}.id`), path: file, loop: v.loop };
}

function ui(v: unknown, index: number): UiDef {
  const path = `ui[${index}]`;
  if (!isObject(v)) fail(path, "must be an object");
  const file = str(v.path, `${path}.path`);
  if (!UI_PATH.test(file)) fail(`${path}.path`, `must be a same origin /assets/ui png or ttf path, got ${file}`);
  if (!UI_KINDS.includes(v.kind as UiKind)) fail(`${path}.kind`, `must be one of ${UI_KINDS.join(", ")}`);
  const def: UiDef = {
    id: str(v.id, `${path}.id`),
    kind: v.kind as UiKind,
    path: file,
    width: posInt(v.width, `${path}.width`, 0),
    height: posInt(v.height, `${path}.height`, 0),
  };
  if (v.slice !== undefined) {
    if (!isObject(v.slice)) fail(`${path}.slice`, "must be an object");
    const slice = { x: posInt(v.slice.x, `${path}.slice.x`), y: posInt(v.slice.y, `${path}.slice.y`) };
    // Overlapping corners would smear the frame rather than tile it.
    if (slice.x * 2 > def.width || slice.y * 2 > def.height) {
      fail(`${path}.slice`, `${slice.x}x${slice.y} does not fit inside ${def.width}x${def.height}`);
    }
    def.slice = slice;
  }
  if (def.kind === "ninePatch" && def.slice === undefined) fail(`${path}.slice`, "a nine patch needs a slice");
  if (v.tile !== undefined) def.tile = posInt(v.tile, `${path}.tile`);
  return def;
}

function idMap(v: unknown, path: string): Record<string, string> {
  if (!isObject(v)) fail(path, "must be an object");
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(v)) out[key] = str(value, `${path}.${key}`);
  return out;
}

function size(v: unknown, path: string): { width: number; height: number } {
  if (!isObject(v)) fail(path, "must be an object");
  return { width: posInt(v.width, `${path}.width`), height: posInt(v.height, `${path}.height`) };
}

/**
 * A face with no fighter behind it.
 *
 * Validated like everything else, because a portrait that is silently dropped
 * is a blank square on screen rather than a failure anybody notices.
 */
function portrait(value: unknown): ManifestPortrait {
  if (!isObject(value)) fail("portraits", "each portrait must be an object");
  return {
    id: str(value.id, "portraits.id"),
    sourceFolder: str(value.sourceFolder, "portraits.sourceFolder"),
    facesetPath: assetPath(value.facesetPath, "portraits.facesetPath"),
    width: posInt(value.width, "portraits.width"),
    height: posInt(value.height, "portraits.height"),
  };
}

export function parseManifest(json: unknown): Manifest {
  if (!isObject(json)) fail("", "manifest must be an object");
  const facingOrder = json.facingOrder;
  if (!Array.isArray(facingOrder) || facingOrder.join(",") !== FACING_NAMES.join(",")) {
    fail("facingOrder", `must be ${FACING_NAMES.join(", ")}`);
  }
  if (!Array.isArray(json.entries) || json.entries.length < 1) fail("entries", "must be a non empty array");
  if (!Array.isArray(json.fx)) fail("fx", "must be an array");
  if (!Array.isArray(json.audio)) fail("audio", "must be an array");
  if (!Array.isArray(json.ui)) fail("ui", "must be an array");
  if (!Array.isArray(json.warnings) || json.warnings.some((w) => typeof w !== "string")) fail("warnings", "must be an array of strings");

  // Optional, so a manifest written before portraits existed still parses.
  if (json.portraits !== undefined && !Array.isArray(json.portraits)) fail("portraits", "must be an array when present");
  const portraits = Array.isArray(json.portraits) ? json.portraits.map(portrait) : [];
  if (new Set(portraits.map((p) => p.id)).size !== portraits.length) fail("portraits", "ids must be unique");

  const entries = json.entries.map(entry);
  if (new Set(entries.map((e) => e.id)).size !== entries.length) fail("entries", "ids must be unique");
  const fxList = json.fx.map(fx);
  if (new Set(fxList.map((f) => f.id)).size !== fxList.length) fail("fx", "ids must be unique");
  const audioList = json.audio.map(audio);
  if (new Set(audioList.map((a) => a.id)).size !== audioList.length) fail("audio", "ids must be unique");
  const uiList = json.ui.map(ui);
  if (new Set(uiList.map((u) => u.id)).size !== uiList.length) fail("ui", "ids must be unique");
  const emotes = idMap(json.emotes, "emotes");
  const modeIcons = idMap(json.modeIcons, "modeIcons");
  // Every referenced id must actually exist, so a missing sprite fails here
  // rather than as a blank square on screen.
  const uiIds = new Set(uiList.map((u) => u.id));
  for (const [meaning, id] of Object.entries({ ...emotes, ...modeIcons })) {
    if (!uiIds.has(id)) fail(`emotes/modeIcons.${meaning}`, `references unknown ui id ${id}`);
  }

  return {
    source: str(json.source, "source"),
    pack: str(json.pack, "pack"),
    frame: size(json.frame, "frame"),
    faceset: size(json.faceset, "faceset"),
    facingOrder: [...FACING_NAMES],
    entries,
    portraits,
    fx: fxList,
    audio: audioList,
    ui: uiList,
    emotes,
    modeIcons,
    warnings: json.warnings as string[],
  };
}
