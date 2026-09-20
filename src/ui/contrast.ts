// Contrast checking for text on a surface.
//
// Threshold: 4.5:1, the WCAG AA ratio for body text. It is chosen rather than
// inherited because this interface is pixel art at small sizes on textured
// panels, where anything looser stops being readable at arm's length. Large
// display text is allowed 3:1, the AA large-text ratio, and only where the
// size actually qualifies.

export const AA_BODY = 4.5;
export const AA_LARGE = 3;

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** Relative luminance, per the WCAG definition. */
export function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) throw new RangeError(`expected a six digit hex colour, got ${hex}`);
  const n = Number.parseInt(clean, 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two opaque colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

export interface TextOnSurface {
  what: string;
  text: string;
  surface: string;
  /** Large display text may use the 3:1 ratio. */
  large?: boolean;
}

export function failures(pairs: readonly TextOnSurface[]): string[] {
  return pairs
    .map((p) => ({ ...p, ratio: contrastRatio(p.text, p.surface), need: p.large ? AA_LARGE : AA_BODY }))
    .filter((p) => p.ratio < p.need)
    .map((p) => `${p.what}: ${p.text} on ${p.surface} is ${p.ratio}:1, needs ${p.need}:1`);
}

/** A translucent colour resolved against what is behind it. */
export function flatten(fg: string, bg: string, alpha: number): string {
  const f = Number.parseInt(fg.replace("#", ""), 16);
  const b = Number.parseInt(bg.replace("#", ""), 16);
  const mix = (shift: number): number => Math.round((((f >> shift) & 255) * alpha) + (((b >> shift) & 255) * (1 - alpha)));
  return `#${[mix(16), mix(8), mix(0)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
