// Pure helpers for the asset extraction script. Kept free of I/O so they
// can be unit tested without the zip.

import type { Tier } from "../../src/config/roster";

export interface PngSize {
  width: number;
  height: number;
}

export const EXPECTED = {
  faceset: 38,
  frame: 16,
  monsterSheet: 64,
} as const;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads width and height from a PNG IHDR chunk. Throws on anything that is not a PNG. */
export function readPngSize(buf: Buffer): PngSize {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG: bad signature or truncated");
  }
  if (buf.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("not a PNG: first chunk is not IHDR");
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function frameGrid(width: number, height: number, frameSize: number): { cols: number; rows: number } {
  if (width % frameSize !== 0 || height % frameSize !== 0) {
    throw new Error(`${width}x${height} is not a multiple of ${frameSize}x${frameSize}`);
  }
  return { cols: width / frameSize, rows: height / frameSize };
}

const PLAIN_PNG = /^[A-Za-z0-9_-]+\.png$/i;
const FACESET = /^faceset\.png$/i;

/** The single non Faceset png in a monster folder. Name and case vary across monsters. */
export function pickMonsterSheet(names: readonly string[]): string {
  const candidates = names.filter((n) => PLAIN_PNG.test(n) && !FACESET.test(n));
  if (candidates.length !== 1) {
    throw new Error(`expected exactly one sprite sheet, found ${candidates.length}: ${candidates.join(", ")}`);
  }
  return candidates[0];
}

export function isMacosxPath(p: string): boolean {
  return p.split("/").some((seg) => seg === "__MACOSX" || seg.startsWith("._"));
}

export interface DimensionReport {
  id: string;
  tier: Tier;
  faceset: PngSize;
  sheets: Record<string, PngSize>;
}

/** Human readable mismatches against the expected pack dimensions. Empty when all good. */
export function dimensionWarnings(r: DimensionReport): string[] {
  const out: string[] = [];
  const size = (s: PngSize) => `${s.width}x${s.height}`;
  if (r.faceset.width !== EXPECTED.faceset || r.faceset.height !== EXPECTED.faceset) {
    out.push(`${r.id}: Faceset.png is ${size(r.faceset)}, expected ${EXPECTED.faceset}x${EXPECTED.faceset}`);
  }
  for (const [name, s] of Object.entries(r.sheets)) {
    if (r.tier === "rare") {
      if (s.width !== EXPECTED.monsterSheet || s.height !== EXPECTED.monsterSheet) {
        out.push(`${r.id}: ${name} is ${size(s)}, expected ${EXPECTED.monsterSheet}x${EXPECTED.monsterSheet}`);
      }
    } else if (s.width % EXPECTED.frame !== 0 || s.height % EXPECTED.frame !== 0) {
      out.push(`${r.id}: ${name} is ${size(s)}, expected multiples of ${EXPECTED.frame}x${EXPECTED.frame}`);
    }
  }
  return out;
}

/**
 * Which sheet column holds each facing, indexed by facing value
 * (0 down, 1 up, 2 left, 3 right). Verified by eye on the extracted sheets
 * at 16x zoom: every character and Cyclope use the pack's default order,
 * Bear stores left before up, Dragon has no uniform columns at all.
 */
const DEFAULT_FACING_COLUMNS: readonly number[] = [0, 1, 2, 3];

const FACING_COLUMN_OVERRIDES: Record<string, readonly number[] | null> = {
  Bear: [0, 2, 1, 3],
  Dragon: null,
};

/** Hand verified layout notes that dimensions alone cannot reveal. Copied into manifest warnings. */
export const SHEET_NOTES: Record<string, string> = {
  Dragon:
    "Dragon: facingColumns is null on purpose, frames come from the hand sliced frameRects list. A pixel check shows columns 2 and 3 are mirror image 16 px frames (left, right) whose wings meet at the cell boundary, not one 32 px frame as phase 1 first recorded",
};

export function facingColumnsFor(id: string): number[] | null {
  const columns = Object.prototype.hasOwnProperty.call(FACING_COLUMN_OVERRIDES, id)
    ? FACING_COLUMN_OVERRIDES[id]
    : DEFAULT_FACING_COLUMNS;
  return columns === null ? null : [...columns];
}

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FacingName = "down" | "up" | "left" | "right";
export const FACING_NAMES: readonly FacingName[] = ["down", "up", "left", "right"];

const column = (x: number): FrameRect[] => [0, 1, 2, 3].map((row) => ({ x, y: row * 16, w: 16, h: 16 }));

/**
 * Hand sliced Dragon frames. Verified on the extracted sheet: opaque bounding
 * boxes fill each 16 px cell (x 0..15, 16..31, 32..47, 48..63), columns 2
 * and 3 are exact mirror images, rows are animation frames. Column order by
 * eye: front (down), back (up), wing trailing right (left), wing trailing
 * left (right).
 */
export const DRAGON_FRAME_RECTS: Record<FacingName, FrameRect[]> = {
  down: column(0),
  up: column(16),
  left: column(32),
  right: column(48),
};

export const FRAME_RECT_OVERRIDES: Record<string, Record<FacingName, FrameRect[]>> = {
  Dragon: DRAGON_FRAME_RECTS,
};

export interface FxSheetSource {
  id: string;
  group: "attack" | "smoke" | "explosion";
  /** Path inside the pack, relative to the pack root. */
  source: string;
}

/** FX strips used by the renderer. FX/Slash is left out: its frame widths do not equal the sheet height. */
export const FX_SHEETS: readonly FxSheetSource[] = [
  { id: "Cut", group: "attack", source: "FX/Attack/Cut/SpriteSheet.png" },
  { id: "CutDouble", group: "attack", source: "FX/Attack/CutDouble/SpriteSheet.png" },
  { id: "CutX", group: "attack", source: "FX/Attack/CutX/SpriteSheet.png" },
  { id: "Claw", group: "attack", source: "FX/Attack/Claw/SpriteSheet.png" },
  { id: "ClawDouble", group: "attack", source: "FX/Attack/ClawDouble/SpriteSheet.png" },
  { id: "SlashCurved", group: "attack", source: "FX/Attack/SlashCurved/SpriteSheet.png" },
  { id: "SlashDoubleCurved", group: "attack", source: "FX/Attack/SlashDoubleCurved/SpriteSheet.png" },
  { id: "CircularSlash", group: "attack", source: "FX/Attack/CircularSlash/SpriteSheet.png" },
  { id: "Smoke", group: "smoke", source: "FX/Smoke/Smoke/SpriteSheet.png" },
  { id: "Explosion", group: "explosion", source: "FX/Elemental/Explosion/SpriteSheet.png" },
];

/** FX strips are one row of square frames, frame size equals the sheet height. */
export function fxFrameGrid(width: number, height: number): { frameWidth: number; frameHeight: number; cols: number; rows: number } {
  if (height < 1 || width % height !== 0) {
    throw new Error(`${width}x${height} is not a whole multiple of square ${height}x${height} frames`);
  }
  return { frameWidth: height, frameHeight: height, cols: width / height, rows: 1 };
}

export interface AudioSource {
  id: string;
  /** Path inside the pack, relative to the pack root. */
  source: string;
  /** Looping beds must be seamless; one shots must not loop. */
  loop: boolean;
}

/**
 * Sounds the slot machine uses, from the pack's 132 effects and 15 jingles.
 * Only the ones actually played are extracted, to keep the committed payload
 * small. The payout is deliberately two samples, a sharp transient over a low
 * body, because either alone reads thin.
 */
export const AUDIO_SOURCES: readonly AudioSource[] = [
  { id: "leverPull", source: "Audio/Sounds/Whoosh & Slash/Whoosh.wav", loop: false },
  { id: "reelSpin", source: "Audio/Sounds/Whoosh & Slash/Whoosh2.wav", loop: true },
  { id: "reelStop", source: "Audio/Sounds/Menu/Move4.wav", loop: false },
  { id: "nearMiss", source: "Audio/Sounds/Alert/Alert2.wav", loop: false },
  { id: "winSting", source: "Audio/Jingles/Success1.wav", loop: false },
  { id: "jackpotSting", source: "Audio/Jingles/LevelUp3.wav", loop: false },
  { id: "payoutTransient", source: "Audio/Sounds/Bonus/Coin3.wav", loop: false },
  { id: "payoutBody", source: "Audio/Sounds/Bonus/Gold1.wav", loop: false },
  { id: "uiSelect", source: "Audio/Sounds/Menu/Accept4.wav", loop: false },
  { id: "uiLocked", source: "Audio/Sounds/Menu/Cancel.wav", loop: false },
];

export type UiKind = "ninePatch" | "sprite" | "tileset" | "font";

export interface UiSource {
  id: string;
  /** Path inside the pack, relative to the pack root. */
  source: string;
  kind: UiKind;
  /**
   * Nine patch slice inset in pixels, measured from the sprite rather than
   * guessed: the corner artwork spans this many pixels before the edge starts
   * repeating. Corners draw untouched, edges and centre tile in whole pixels.
   */
  slice?: number | { x: number; y: number };
  /** Tile size for a tileset, so the renderer can pick cells. */
  tile?: number;
}

/**
 * UI art from the pack. The nine patch slices were read off the pixels:
 * the 16x16 panels carry 6 px corners, the 8x8 focus ring 3 px, and the
 * 16x8 button 6 px across and 3 down.
 */
export const UI_SOURCES: readonly UiSource[] = [
  // Nine patch containers: every panel, card and dialog in the app is one of these.
  { id: "panel", source: "Ui/Theme/Theme Wood/nine_path_panel.png", kind: "ninePatch", slice: 6 },
  { id: "panelAlt", source: "Ui/Theme/Theme Wood/nine_path_panel_2.png", kind: "ninePatch", slice: 6 },
  { id: "panelInterior", source: "Ui/Theme/Theme Wood/nine_path_panel_interior.png", kind: "ninePatch", slice: 6 },
  { id: "panelDisabled", source: "Ui/Theme/Theme Wood/nine_path_panel_disabled.png", kind: "ninePatch", slice: 6 },
  { id: "bg", source: "Ui/Theme/Theme Wood/nine_path_bg.png", kind: "ninePatch", slice: 6 },
  { id: "bgAlt", source: "Ui/Theme/Theme Wood/nine_path_bg_2.png", kind: "ninePatch", slice: 6 },
  { id: "focus", source: "Ui/Theme/Theme Wood/nine_path_focus.png", kind: "ninePatch", slice: 3 },

  // Buttons and tabs, every state, so a pressed button is a different sprite
  // rather than a filter.
  { id: "button", source: "Ui/Theme/Theme Wood/button_normal.png", kind: "ninePatch", slice: { x: 6, y: 3 } },
  { id: "buttonHover", source: "Ui/Theme/Theme Wood/button_hover.png", kind: "ninePatch", slice: { x: 6, y: 3 } },
  { id: "buttonPressed", source: "Ui/Theme/Theme Wood/button_pressed.png", kind: "ninePatch", slice: { x: 6, y: 3 } },
  { id: "buttonDisabled", source: "Ui/Theme/Theme Wood/button_disabled.png", kind: "ninePatch", slice: { x: 6, y: 3 } },
  { id: "tab", source: "Ui/Theme/Theme Wood/tab.png", kind: "ninePatch", slice: { x: 6, y: 4 } },
  { id: "tabSelected", source: "Ui/Theme/Theme Wood/tab_selected.png", kind: "ninePatch", slice: { x: 6, y: 4 } },
  { id: "tabHover", source: "Ui/Theme/Theme Wood/tab_hover.png", kind: "ninePatch", slice: { x: 6, y: 4 } },
  { id: "tabDisabled", source: "Ui/Theme/Theme Wood/tab_disabled.png", kind: "ninePatch", slice: { x: 6, y: 4 } },
  { id: "inventoryCell", source: "Ui/Theme/Theme Wood/inventory_cell.png", kind: "ninePatch", slice: 6 },

  // Dialog frames: the SERV reason strings render in a real dialog box,
  // which is what the asset is for.
  { id: "dialogBox", source: "Ui/Dialog/DialogBox.png", kind: "sprite" },
  { id: "dialogSimple", source: "Ui/Dialog/DialogueBoxSimple.png", kind: "sprite" },
  { id: "dialogFaceset", source: "Ui/Dialog/DialogBoxFaceset.png", kind: "sprite" },
  { id: "facesetBox", source: "Ui/Dialog/FacesetBox.png", kind: "sprite" },
  { id: "dialogInfo", source: "Ui/Dialog/DialogInfo.png", kind: "sprite" },

  // Meters: bankroll and load progress are drawn, not printed as numbers.
  { id: "lifeBarUnder", source: "Ui/Receptacle/LifeBarMiniUnder.png", kind: "sprite" },
  { id: "lifeBarProgress", source: "Ui/Receptacle/LifeBarMiniProgress.png", kind: "sprite" },
  { id: "meterBack", source: "Ui/Receptacle/Receptacle Rectangle/BackgroundWood.png", kind: "sprite" },
  { id: "meterFill", source: "Ui/Receptacle/Receptacle Rectangle/ProgressWhite.png", kind: "sprite" },
  { id: "meterHealth", source: "Ui/Receptacle/Receptacle Rectangle/ProgressHealth.png", kind: "sprite" },
  { id: "heart", source: "Ui/Receptacle/IconHeart.png", kind: "sprite" },

  // Fonts. NormalFont.ttf is the interface face; the bitmap sheets are for
  // numerals and headings.
  { id: "fontNormal", source: "Ui/Font/NormalFont.ttf", kind: "font" },
  { id: "fontBitmapSmall", source: "Ui/Font/font8x8.png", kind: "font" },
  { id: "fontBitmapLarge", source: "Ui/Font/font24x30.png", kind: "font" },

  // Backdrop and arena floor.
  { id: "tilesetDungeon", source: "Backgrounds/Tilesets/TilesetDungeon.png", kind: "tileset", tile: 16 },
  { id: "tilesetFloor", source: "Backgrounds/Tilesets/TilesetFloor.png", kind: "tileset", tile: 16 },
  { id: "tilesetFloorDetail", source: "Backgrounds/Tilesets/TilesetFloorDetail.png", kind: "tileset", tile: 16 },
  { id: "tilesetRelief", source: "Backgrounds/Tilesets/TilesetRelief.png", kind: "tileset", tile: 16 },
];

/**
 * Emote bubbles conveying agent state. The pack names them emote1 to emote30
 * with no semantics, so the meaning is assigned here and the numbers were
 * picked by looking at the sprites.
 */
export const UI_EMOTES: Record<string, string> = {
  committed: "emote1",
  holding: "emote4",
  thinking: "emote2",
  broke: "emote10",
  won: "emote7",
  lost: "emote6",
};

/**
 * Skill icons used as mode identities on the select screen. Names are the
 * pack's own; each mode gets one that reads as its character.
 */
export const UI_SKILL_ICONS: Record<string, string> = {
  battleRoyale: "Spell/Cut",
  gauntlet: "Items & Weapon/Guard",
  duel: "Spell/Counter",
  placement: "Spell/Permutation",
  highRoller: "Items & Weapon/Money",
  locked: "Job & Action/Mine",
};
