// Design tokens. Everything downstream reads these; no component carries a
// colour, a spacing value or a duration of its own.
//
// Direction: the pack is a lamplit dungeon. The wood nine patches and the
// dungeon tileset bring their own warm browns and cool stone, so the palette
// around them stays dark and desaturated and lets the art carry the colour.
// One accent, amber, which is already the rare tier colour on the hp bars and
// the payline, so the whole product agrees with itself.
//
// No purple anywhere, no gradients, and nothing highlights with a coloured bar
// down its side; emphasis is the focus nine patch or the amber accent.

export const palette = {
  /** Page behind everything. Cool dungeon stone, darker than the panels. */
  pit: "#14170f",
  pitDeep: "#0d0f0a",
  /** Sits under a nine patch where one needs a readable interior. */
  interior: "#1d2117",
  /** Warm bone, the reading colour. */
  bone: "#e8e2cf",
  boneDim: "#a8a293",
  /** Lamplight. The single accent. */
  amber: "#ffb300",
  amberDeep: "#c98200",
  /** Structure that is not art. */
  edge: "#3d4133",
  edgeSoft: "#2a2e22",
  /** Tier colours, matching the arena hp bars so a rare reads rare everywhere. */
  tier: { common: "#7cb342", uncommon: "#42a5f5", rare: "#ffb300" },
  /** Semantic. Never a coloured side bar, only text or a small mark. */
  good: "#7cb342",
  bad: "#e05a3a",
} as const;

/** Spacing steps. The art is 16 px pixel art, so the scale is built on 4. */
export const space = {
  hair: 2,
  tight: 4,
  snug: 8,
  base: 12,
  wide: 16,
  loose: 24,
  vast: 40,
} as const;

/**
 * Type scale. NormalFont is the pack's own pixel face and is the interface
 * font; the bitmap sheets are used for numerals and headings where a drawn
 * glyph reads better than a rendered one.
 */
export const type = {
  family: {
    ui: "'ServpitNormal', 'Courier New', monospace",
    numeral: "'ServpitNormal', 'Courier New', monospace",
  },
  size: { micro: 10, small: 12, body: 14, lead: 18, title: 26, hero: 44 },
  leading: { tight: 1.15, body: 1.5 },
  tracking: { tight: "0.01em", wide: "0.08em" },
} as const;

/**
 * Timing. anime.js drives DOM chrome only; the canvas Timeline still owns reel
 * motion and arena playback, and the two never animate the same element.
 */
export const timing = {
  /** A control answering a press. */
  tap: 120,
  /** An element arriving or leaving. */
  move: 260,
  /** A screen handing over to the next. */
  screen: 460,
  /** Gap between staggered siblings. */
  stagger: 42,
  /** Overlap between the outgoing and incoming screen, as a timeline offset. */
  overlap: -220,
} as const;

/** Integer pixel scale for the pixel art. Never fractional. */
export const uiScale = 3;

/** Every token as CSS custom properties, applied once at the root. */
export function tokensToCss(): string {
  const lines = [
    `--pit: ${palette.pit}`,
    `--pit-deep: ${palette.pitDeep}`,
    `--interior: ${palette.interior}`,
    `--bone: ${palette.bone}`,
    `--bone-dim: ${palette.boneDim}`,
    `--amber: ${palette.amber}`,
    `--amber-deep: ${palette.amberDeep}`,
    `--edge: ${palette.edge}`,
    `--edge-soft: ${palette.edgeSoft}`,
    `--good: ${palette.good}`,
    `--bad: ${palette.bad}`,
    `--tier-common: ${palette.tier.common}`,
    `--tier-uncommon: ${palette.tier.uncommon}`,
    `--tier-rare: ${palette.tier.rare}`,
    `--font-ui: ${type.family.ui}`,
    `--ui-scale: ${uiScale}`,
  ];
  for (const [name, value] of Object.entries(space)) lines.push(`--space-${name}: ${value}px`);
  for (const [name, value] of Object.entries(type.size)) lines.push(`--text-${name}: ${value}px`);
  for (const [name, value] of Object.entries(timing)) lines.push(`--time-${name}: ${value}ms`);
  return lines.join(";\n  ");
}
