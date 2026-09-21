// Pulls only the locked roster out of ninja-adventure.zip into public/assets
// and writes public/assets/manifest.json with real PNG dimensions.
//
// Usage: npm run extract-assets
//
// The zip is never committed. Extraction goes through a temp staging
// directory outside the repo which is deleted on success and left in
// place (path printed) on failure so the problem can be inspected.

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CHARACTER_ANIMATIONS, PORTRAITS, ROSTER, type PortraitEntry, type RosterEntry, type Tier } from "../src/config/roster";
import {
  AUDIO_SOURCES,
  UI_EMOTES,
  UI_SKILL_ICONS,
  UI_SOURCES,
  EXPECTED,
  FRAME_RECT_OVERRIDES,
  FX_SHEETS,
  SHEET_NOTES,
  dimensionWarnings,
  facingColumnsFor,
  frameGrid,
  fxFrameGrid,
  isMacosxPath,
  pickMonsterSheet,
  readPngSize,
  type FacingName,
  type UiKind,
  type FrameRect,
  type PngSize,
} from "./lib/assets";

interface SpriteSheet {
  path: string;
  frameWidth: number;
  frameHeight: number;
  cols: number;
  rows: number;
  /** Sheet column for each facing value (0 down, 1 up, 2 left, 3 right), or null when frameRects carries the slicing. */
  facingColumns: number[] | null;
  /** Explicit hand sliced frames per facing, used when facingColumns is null. */
  frameRects?: Record<FacingName, FrameRect[]>;
}

interface AudioEntry {
  id: string;
  source: string;
  path: string;
  loop: boolean;
  bytes: number;
}

interface UiEntry {
  id: string;
  kind: UiKind;
  source: string;
  path: string;
  width: number;
  height: number;
  /** Nine patch inset in pixels, corners first. Absent for a plain sprite. */
  slice?: { x: number; y: number };
  /** Tile size for a tileset. */
  tile?: number;
}

interface FxEntry {
  id: string;
  group: string;
  source: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
  cols: number;
  rows: number;
}

interface ManifestPortrait {
  id: string;
  sourceFolder: string;
  facesetPath: string;
  width: number;
  height: number;
}

interface ManifestEntry {
  id: string;
  tier: Tier;
  sourceFolder: string;
  facesetPath: string;
  sprites: Record<string, SpriteSheet>;
}

interface Manifest {
  source: string;
  pack: string;
  frame: PngSize;
  faceset: PngSize;
  /** Meaning of facing values 0 to 3 in the event log and in facingColumns. */
  facingOrder: string[];
  entries: ManifestEntry[];
  portraits: ManifestPortrait[];
  fx: FxEntry[];
  audio: AudioEntry[];
  ui: UiEntry[];
  /** Emote bubble ids by the meaning this app assigns them. */
  emotes: Record<string, string>;
  /** Mode icon ids by mode. */
  modeIcons: Record<string, string>;
  warnings: string[];
}

const repoRoot = resolve(import.meta.dirname, "..");
const zipPath = join(repoRoot, "ninja-adventure.zip");
const outDir = join(repoRoot, "public", "assets");

function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args[0]} failed (${r.status}): ${r.stderr.trim()}`);
  }
  return r.stdout;
}

function detectPackRoot(): string {
  const roots = new Set<string>();
  for (const line of run("unzip", ["-Z1", zipPath]).split("\n")) {
    if (!line || isMacosxPath(line) || !line.includes("/Actor/")) continue;
    roots.add(line.slice(0, line.indexOf("/")));
  }
  if (roots.size !== 1) {
    throw new Error(`expected one pack root containing Actor/, found: ${[...roots].join(", ") || "none"}`);
  }
  const root = [...roots][0];
  if (root === "" || root === "." || root === ".." || root.includes("\\")) {
    throw new Error(`unsafe pack root: ${JSON.stringify(root)}`);
  }
  return root;
}

function sizeOf(file: string): PngSize {
  return readPngSize(readFileSync(file));
}

function sheetFor(file: string, publicPath: string, warnings: string[], label: string, facingColumns: number[] | null): { sheet: SpriteSheet; size: PngSize } {
  const size = sizeOf(file);
  let cols = 1;
  let rows = 1;
  let frameWidth = size.width;
  let frameHeight = size.height;
  try {
    ({ cols, rows } = frameGrid(size.width, size.height, EXPECTED.frame));
    frameWidth = EXPECTED.frame;
    frameHeight = EXPECTED.frame;
  } catch (e) {
    warnings.push(`${label}: ${(e as Error).message}, recorded as a single frame`);
  }
  // A single column sheet (Dead.png) serves every facing from column 0.
  const columns = facingColumns !== null && cols === 1 ? [0, 0, 0, 0] : facingColumns;
  return { sheet: { path: publicPath, frameWidth, frameHeight, cols, rows, facingColumns: columns }, size };
}

/**
 * A faceset and nothing else.
 *
 * Marrow has no sprites because it never fights. Copying its idle and attack
 * sheets would put art in the bundle that nothing can ever draw.
 */
function buildPortrait(entry: PortraitEntry, staging: string, packRoot: string): ManifestPortrait {
  const facesetSrc = join(staging, packRoot, entry.sourceFolder, "Faceset.png");
  if (!existsSync(facesetSrc)) throw new Error(`${entry.id}: Faceset.png missing in pack at ${entry.sourceFolder}`);
  const destDir = join(outDir, entry.id);
  mkdirSync(destDir, { recursive: true });
  copyFileSync(facesetSrc, join(destDir, "Faceset.png"));
  const size = sizeOf(facesetSrc);
  return { id: entry.id, sourceFolder: entry.sourceFolder, facesetPath: `/assets/${entry.id}/Faceset.png`, width: size.width, height: size.height };
}

function buildEntry(entry: RosterEntry, staging: string, packRoot: string, warnings: string[]): ManifestEntry {
  const srcDir = join(staging, packRoot, entry.sourceFolder);
  const destDir = join(outDir, entry.id);
  mkdirSync(destDir, { recursive: true });

  const facesetSrc = join(srcDir, "Faceset.png");
  if (!existsSync(facesetSrc)) throw new Error(`${entry.id}: Faceset.png missing in pack`);
  copyFileSync(facesetSrc, join(destDir, "Faceset.png"));
  const faceset = sizeOf(facesetSrc);

  const sprites: Record<string, SpriteSheet> = {};
  const sheets: Record<string, PngSize> = {};
  const facingColumns = facingColumnsFor(entry.id);
  if (Object.prototype.hasOwnProperty.call(SHEET_NOTES, entry.id)) warnings.push(SHEET_NOTES[entry.id]);

  if (entry.tier === "rare") {
    const name = pickMonsterSheet(readdirSync(srcDir));
    copyFileSync(join(srcDir, name), join(destDir, name));
    const { sheet, size } = sheetFor(join(srcDir, name), `/assets/${entry.id}/${name}`, warnings, `${entry.id}: ${name}`, facingColumns);
    if (Object.prototype.hasOwnProperty.call(FRAME_RECT_OVERRIDES, entry.id)) sheet.frameRects = FRAME_RECT_OVERRIDES[entry.id];
    sprites.sheet = sheet;
    sheets.sheet = size;
  } else {
    for (const anim of CHARACTER_ANIMATIONS) {
      const src = join(srcDir, "SeparateAnim", `${anim}.png`);
      if (!existsSync(src)) {
        warnings.push(`${entry.id}: SeparateAnim/${anim}.png missing in pack, animation omitted`);
        continue;
      }
      copyFileSync(src, join(destDir, `${anim}.png`));
      const key = anim.toLowerCase();
      const { sheet, size } = sheetFor(src, `/assets/${entry.id}/${anim}.png`, warnings, `${entry.id}: ${anim}.png`, facingColumns);
      sprites[key] = sheet;
      sheets[key] = size;
    }
  }

  warnings.push(...dimensionWarnings({ id: entry.id, tier: entry.tier, faceset, sheets }));

  return {
    id: entry.id,
    tier: entry.tier,
    sourceFolder: entry.sourceFolder,
    facesetPath: `/assets/${entry.id}/Faceset.png`,
    sprites,
  };
}

function buildFx(staging: string, packRoot: string): FxEntry[] {
  const fxDir = join(outDir, "fx");
  mkdirSync(fxDir, { recursive: true });
  return FX_SHEETS.map((fx) => {
    const src = join(staging, packRoot, fx.source);
    if (!existsSync(src)) throw new Error(`fx ${fx.id}: ${fx.source} missing in pack`);
    const size = sizeOf(src);
    const grid = fxFrameGrid(size.width, size.height);
    copyFileSync(src, join(fxDir, `${fx.id}.png`));
    return { id: fx.id, group: fx.group, source: fx.source, path: `/assets/fx/${fx.id}.png`, ...grid };
  });
}

function buildAudio(staging: string, packRoot: string): AudioEntry[] {
  const audioDir = join(outDir, "audio");
  mkdirSync(audioDir, { recursive: true });
  return AUDIO_SOURCES.map((sound) => {
    const src = join(staging, packRoot, sound.source);
    if (!existsSync(src)) throw new Error(`audio ${sound.id}: ${sound.source} missing in pack`);
    copyFileSync(src, join(audioDir, `${sound.id}.wav`));
    return { id: sound.id, source: sound.source, path: `/assets/audio/${sound.id}.wav`, loop: sound.loop, bytes: statSync(src).size };
  });
}

/**
 * UI art, tilesets and fonts. A font has no readable dimensions, so only the
 * images are measured; everything else records its real size the same way the
 * sprite sheets do.
 */
function buildUi(staging: string, packRoot: string, warnings: string[]): UiEntry[] {
  const uiDir = join(outDir, "ui");
  mkdirSync(uiDir, { recursive: true });

  const entries = UI_SOURCES.map((ui) => {
    const src = join(staging, packRoot, ui.source);
    if (!existsSync(src)) throw new Error(`ui ${ui.id}: ${ui.source} missing in pack`);
    const extension = ui.source.slice(ui.source.lastIndexOf("."));
    const fileName = `${ui.id}${extension}`;
    copyFileSync(src, join(uiDir, fileName));

    const entry: UiEntry = { id: ui.id, kind: ui.kind, source: ui.source, path: `/assets/ui/${fileName}`, width: 0, height: 0 };
    if (extension === ".png") {
      const size = sizeOf(src);
      entry.width = size.width;
      entry.height = size.height;
      if (ui.slice !== undefined) {
        const slice = typeof ui.slice === "number" ? { x: ui.slice, y: ui.slice } : ui.slice;
        // A slice wider than half the sprite would make opposite corners
        // overlap, which reads as a smeared frame rather than a panel.
        if (slice.x * 2 > size.width || slice.y * 2 > size.height) {
          warnings.push(`ui ${ui.id}: slice ${slice.x}x${slice.y} does not fit ${size.width}x${size.height}`);
        }
        entry.slice = slice;
      }
      if (ui.tile !== undefined) {
        entry.tile = ui.tile;
        // A sheet that is not a whole number of tiles will mis-tile on its last
        // row or column. Record it rather than let it show up as a seam.
        if (size.width % ui.tile !== 0 || size.height % ui.tile !== 0) {
          warnings.push(
            `ui ${ui.id}: ${size.width}x${size.height} is not a whole number of ${ui.tile} px tiles, ` +
              `usable grid is ${Math.floor(size.width / ui.tile)}x${Math.floor(size.height / ui.tile)}`,
          );
        }
      }
    }
    return entry;
  });

  // Emotes and skill icons are copied under their own ids so the app never
  // has to know the pack's naming.
  for (const [meaning, file] of Object.entries(UI_EMOTES)) {
    const src = join(staging, packRoot, `Ui/Emote/${file}.png`);
    if (!existsSync(src)) throw new Error(`emote ${meaning}: Ui/Emote/${file}.png missing in pack`);
    const size = sizeOf(src);
    copyFileSync(src, join(uiDir, `emote-${meaning}.png`));
    entries.push({ id: `emote-${meaning}`, kind: "sprite", source: `Ui/Emote/${file}.png`, path: `/assets/ui/emote-${meaning}.png`, width: size.width, height: size.height });
  }
  for (const [mode, file] of Object.entries(UI_SKILL_ICONS)) {
    const src = join(staging, packRoot, `Ui/Skill Icon/${file}.png`);
    if (!existsSync(src)) throw new Error(`icon ${mode}: Ui/Skill Icon/${file}.png missing in pack`);
    const size = sizeOf(src);
    copyFileSync(src, join(uiDir, `icon-${mode}.png`));
    entries.push({ id: `icon-${mode}`, kind: "sprite", source: `Ui/Skill Icon/${file}.png`, path: `/assets/ui/icon-${mode}.png`, width: size.width, height: size.height });
  }

  return entries;
}

function totalBytes(dir: string): number {
  let sum = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    sum += st.isDirectory() ? totalBytes(p) : st.size;
  }
  return sum;
}

function main(): void {
  if (!existsSync(zipPath)) {
    throw new Error(`zip not found at ${zipPath}. Place the Ninja Adventure pack there as ninja-adventure.zip`);
  }
  const packRoot = detectPackRoot();
  const staging = mkdtempSync(join(tmpdir(), "servpit-assets-"));
  console.log(`pack root: ${packRoot}`);
  console.log(`staging:   ${staging}`);

  try {
    const patterns = [
      ...ROSTER.map((e) => `${packRoot}/${e.sourceFolder}/*`),
      // Portraits need one file each, so only that file is unzipped.
      ...PORTRAITS.map((e) => `${packRoot}/${e.sourceFolder}/Faceset.png`),
      ...FX_SHEETS.map((fx) => `${packRoot}/${fx.source}`),
      ...AUDIO_SOURCES.map((sound) => `${packRoot}/${sound.source}`),
      ...UI_SOURCES.map((ui) => `${packRoot}/${ui.source}`),
      ...Object.values(UI_EMOTES).map((file) => `${packRoot}/Ui/Emote/${file}.png`),
      ...Object.values(UI_SKILL_ICONS).map((file) => `${packRoot}/Ui/Skill Icon/${file}.png`),
    ];
    run("unzip", ["-q", "-o", zipPath, ...patterns, "-x", "__MACOSX/*", "-d", staging]);

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    const warnings: string[] = [];
    const entries = ROSTER.map((e) => buildEntry(e, staging, packRoot, warnings));
    const portraits = PORTRAITS.map((e) => buildPortrait(e, staging, packRoot));
    const fx = buildFx(staging, packRoot);
    const audio = buildAudio(staging, packRoot);
    const ui = buildUi(staging, packRoot, warnings);
    const manifest: Manifest = {
      source: "ninja-adventure.zip",
      pack: packRoot,
      frame: { width: EXPECTED.frame, height: EXPECTED.frame },
      faceset: { width: EXPECTED.faceset, height: EXPECTED.faceset },
      facingOrder: ["down", "up", "left", "right"],
      entries,
      portraits,
      fx,
      audio,
      ui,
      emotes: Object.fromEntries(Object.keys(UI_EMOTES).map((k) => [k, `emote-${k}`])),
      modeIcons: Object.fromEntries(Object.keys(UI_SKILL_ICONS).map((k) => [k, `icon-${k}`])),
      warnings,
    };
    writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

    console.log(`entries:   ${entries.length}`);
    console.log(`portraits: ${portraits.length}`);
    console.log(`fx:        ${fx.length}`);
    console.log(`audio:     ${audio.length}`);
    console.log(`ui:        ${ui.length}`);
    console.log(`bytes:     ${totalBytes(outDir)}`);
    for (const w of warnings) console.log(`WARN ${w}`);
  } catch (e) {
    console.error(`extraction failed, staging kept at ${staging}`);
    throw e;
  }
  rmSync(staging, { recursive: true, force: true });
  console.log("staging removed");
}

main();
