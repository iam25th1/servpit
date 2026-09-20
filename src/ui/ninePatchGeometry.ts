// Nine patch geometry. Kept separate from the component so the arithmetic is
// testable without a DOM.
//
// The sprites are 8 to 16 px square with 3 to 6 px corners, so a browser that
// stretched them would turn a carved wooden frame into a smear. CSS
// border-image does the slicing natively: corners draw untouched, edges and
// centre repeat. border-image-repeat: round is the important part, because it
// rounds to a whole number of tiles rather than scaling them fractionally,
// which is what keeps the pixels square.

import type { UiDef } from "@/render/manifest";

export interface NinePatchStyle {
  borderStyle: "solid";
  borderWidth: string;
  borderImageSource: string;
  borderImageSlice: string;
  borderImageWidth: string;
  borderImageRepeat: string;
  imageRendering: "pixelated";
}

/** Inline style that renders a sprite as a nine patch frame at an integer scale. */
export function ninePatchStyle(def: UiDef, scale: number): NinePatchStyle {
  if (!def.slice) throw new Error(`ui sprite ${def.id} has no nine patch slice`);
  if (!Number.isInteger(scale) || scale < 1) throw new RangeError(`scale must be a positive integer, got ${scale}`);
  const top = def.slice.y;
  const side = def.slice.x;
  return {
    borderStyle: "solid",
    // Border box is the corner artwork at scale, so the frame never squashes.
    borderWidth: `${top * scale}px ${side * scale}px`,
    borderImageSource: `url(${def.path})`,
    // fill keeps the centre of the sprite as the panel interior.
    borderImageSlice: `${top} ${side} fill`,
    borderImageWidth: `${top * scale}px ${side * scale}px`,
    // round, not stretch: whole tiles only, so the pixels stay square.
    borderImageRepeat: "round",
    imageRendering: "pixelated",
  };
}

/** Smallest box that can show the frame without its corners overlapping. */
export function minimumSize(def: UiDef, scale: number): { width: number; height: number } {
  if (!def.slice) throw new Error(`ui sprite ${def.id} has no nine patch slice`);
  return { width: def.slice.x * 2 * scale, height: def.slice.y * 2 * scale };
}
