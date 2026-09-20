// The lever's shape, as whole pixels.
//
// The lever used to be a two pixel hairline with a flat disc on top. The
// cabinet's coordinate space puts a symbol cell at 38 logical pixels, so a
// two pixel rod is a scratch on it and a flat disc is a shape no sprite in
// this pack would have. Both are now drawn at the pack's own density: a
// shaded rod with a light edge and a dark edge, and a ball with a rim, a
// highlight and a shadow.
//
// This is geometry only. The renderer maps a tone to a colour.

export type Tone = "rim" | "highlight" | "body" | "shadow";

export interface Run {
  dx: number;
  dy: number;
  width: number;
  tone: Tone;
}

export interface Column {
  dx: number;
  tone: Tone;
}

/** The tone of one pixel of the ball, or null outside it. */
export function ballTone(dx: number, dy: number, radius: number): Tone | null {
  if (!Number.isFinite(radius) || radius < 1) throw new RangeError(`a ball needs a radius of at least 1, got ${radius}`);
  const d2 = dx * dx + dy * dy;
  if (d2 > radius * radius) return null;
  // The outer ring: inside the ball but no longer inside a ball one pixel
  // smaller. This is the dark outline every sprite in the pack has.
  if (d2 > (radius - 1) * (radius - 1)) return "rim";
  // Round patches around an offset light and its opposite, not rectangular
  // corners. A square highlight on a round ball reads as a sticker.
  const lit = radius / 2.5;
  const near = (cx: number, cy: number): number => Math.hypot(dx - cx, dy - cy);
  if (near(-lit, -lit) < radius / 2.2) return "highlight";
  if (near(lit, lit) < radius / 1.9) return "shadow";
  return "body";
}

/** The ball as horizontal runs of one tone, top to bottom, left to right. */
export function knobRows(radius: number): Run[] {
  const runs: Run[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    let start: number | null = null;
    let tone: Tone | null = null;
    for (let dx = -radius; dx <= radius + 1; dx++) {
      const here = dx > radius ? null : ballTone(dx, dy, radius);
      if (here === tone) continue;
      if (tone !== null && start !== null) runs.push({ dx: start, dy, width: dx - start, tone });
      start = here === null ? null : dx;
      tone = here;
    }
  }
  return runs;
}

/** The rod as vertical columns of one tone, left to right. */
export function rodColumns(width: number): Column[] {
  if (!Number.isInteger(width) || width < 3) throw new RangeError(`a rod needs at least 3 pixels to carry a light and a dark edge, got ${width}`);
  const left = -Math.floor(width / 2);
  return Array.from({ length: width }, (_, i) => ({
    dx: left + i,
    tone: i === 0 ? "highlight" : i === width - 1 ? "shadow" : "body",
  }));
}
