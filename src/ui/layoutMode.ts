// Which shape the interface is in.
//
// The game was built as a fixed 1280 by 720 stage, scaled to fit. On a desktop
// that is the whole point: pixel art at a whole scale, a composition that
// cannot reflow into something nobody designed. On a phone it is a disaster.
// Measured on an iPhone 14, the stage fits at 0.305, so sixteen pixel body
// text arrives at just under five pixels tall and a panel of agent reasons is
// a grey smear in the middle of a black screen.
//
// So a phone gets a layout instead of a reduction. Same screens, same
// components, same design system; a different arrangement, chosen here.

export type LayoutMode = "desktop" | "portrait" | "compact";

/**
 * The widest viewport that still gets the portrait layout.
 *
 * A tablet held upright is 768 or 810 wide and reads happily as a tall
 * layout. Past this the fixed stage fits at a scale that is legible again.
 */
export const PORTRAIT_MAX_WIDTH = 820;

/**
 * The shortest viewport that still gets the fixed stage.
 *
 * A phone on its side is about 390 tall. The stage needs 720 of height to be
 * anything but a strip, so anything this short gets the compact arrangement:
 * the same portrait design with its column split in two.
 */
export const COMPACT_MAX_HEIGHT = 520;

/** The layout for a viewport, with no clock, no matchMedia and no window. */
export function layoutFor(width: number, height: number): LayoutMode {
  if (!(width > 0) || !(height > 0)) return "desktop";
  if (height <= COMPACT_MAX_HEIGHT && width > height) return "compact";
  if (width <= PORTRAIT_MAX_WIDTH && height >= width) return "portrait";
  return "desktop";
}

/**
 * The largest whole number scale of a pixel canvas that fits, in device
 * pixels, or null when not even one whole copy fits.
 *
 * A canvas drawn at 496 logical pixels and shown at 390 css pixels is
 * resampled by a fraction, which is how pixel art turns to mush. On a phone
 * with three device pixels per css pixel there is room for two whole copies,
 * so the canvas is shown at 330 css pixels and every source pixel lands on
 * exactly six device pixels.
 */
export function wholePixelWidth(logicalWidth: number, availableCssWidth: number, devicePixelRatio: number): number | null {
  if (!(logicalWidth > 0) || !(availableCssWidth > 0)) return null;
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const factor = Math.floor((availableCssWidth * dpr) / logicalWidth);
  if (factor < 1) return null;
  return (logicalWidth * factor) / dpr;
}
