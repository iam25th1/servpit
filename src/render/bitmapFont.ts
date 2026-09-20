// The pack's 8x8 bitmap font, as geometry.
//
// Canvas text is not an option here. ctx.fillText antialiases, and this
// canvas is drawn at a whole number scale precisely so nothing blurs. A
// bitmap font is drawn the same way every sprite is, one drawSlice per
// glyph on whole pixels, so a name scales exactly like the fighter it sits
// above.
//
// Sheet layout, read off Ui/Font/font8x8.png: 120x64, fifteen columns of
// eight pixel cells, running from space at the top left in ASCII order.
// 'A' is code 65, so index 33, so column 3 of row 2, which is where it is.

/** Pixel size of one glyph cell. */
export const GLYPH = 8;
/** Cells per row on the sheet. */
export const FONT_COLUMNS = 15;
/** The first character the sheet carries. */
export const FONT_FIRST_CHAR = 32;
/** Rows on the sheet, and so the last character it carries. */
export const FONT_ROWS = 8;

export interface GlyphCell {
  col: number;
  row: number;
}

/** Where a character sits on the sheet, or null if the sheet has no glyph for it. */
export function glyphCell(ch: string): GlyphCell | null {
  if (ch.length === 0) return null;
  const index = ch.charCodeAt(0) - FONT_FIRST_CHAR;
  if (index < 0 || index >= FONT_COLUMNS * FONT_ROWS) return null;
  return { col: index % FONT_COLUMNS, row: Math.floor(index / FONT_COLUMNS) };
}

/**
 * Width of a run in pixels. Fixed width, one box per character including a
 * character the sheet cannot draw: closing up the hole would shift every
 * later glyph off the whole pixel grid.
 */
export function textWidth(text: string): number {
  return text.length * GLYPH;
}

/**
 * Left edge of a run centred over a sprite, rounded to a whole pixel.
 *
 * Rounded rather than floored so a name does not sit consistently one pixel
 * left of its fighter. A run wider than the sprite overhangs; nothing here
 * scales or clips it.
 */
export function plateLeft(spriteX: number, spriteWidth: number, text: string): number {
  return Math.round(spriteX + (spriteWidth - textWidth(text)) / 2);
}

/**
 * Keeps a run of given width inside [min, max), on whole pixels.
 *
 * The arena canvas clips, so a fighter standing near a wall had its name run
 * off the edge and simply lose the characters that did not fit. A run wider
 * than the space available is pinned to the near edge, because nothing here
 * scales or truncates and the start of a name is the readable end of it.
 */
export function clampRun(left: number, width: number, min: number, max: number): number {
  if (width >= max - min) return Math.round(min);
  return Math.round(Math.min(Math.max(left, min), max - width));
}
