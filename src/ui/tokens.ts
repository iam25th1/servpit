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
  /** Warm bone, the reading colour on a dark surface. */
  bone: "#e8e2cf",
  boneDim: "#b5afa0",
  /**
   * Bone bright enough for the two mid brown button sprites, where neither
   * ink nor ordinary bone clears 4.5:1.
   */
  boneBright: "#f0ebdb",
  /**
   * The reading colour on a light surface. The pack's panels, buttons, tabs
   * and dialogs are mostly light art, and bone on them was unreadable: the
   * mode blurbs measured 1.05:1 on the wood panel. Ink is the same value as
   * pitDeep, named for the role it plays rather than the surface it is.
   */
  ink: "#0d0f0a",
  inkDim: "#1d2117",
  /** Lamplight. The single accent. */
  amber: "#ffb300",
  amberDeep: "#c98200",
  /** Structure that is not art. */
  edge: "#3d4133",
  edgeSoft: "#2a2e22",
  /** Tier colours, matching the arena hp bars so a rare reads rare everywhere. */
  tier: { common: "#7cb342", uncommon: "#42a5f5", rare: "#ffb300" },
  /**
   * Semantic. Never a coloured side bar, only text or a small mark. Good is
   * a step lighter than the common tier it matches, because as text on the
   * dark bg frame the tier value measured 4.12:1.
   */
  good: "#8bc34a",
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
  /**
   * Raised in phase 7. The previous scale topped out at 14 px for body text
   * on a 1280 wide stage, which is unreadable at a normal viewing distance.
   * Every step moved up and the ratios between them were kept.
   */
  size: { micro: 12, small: 14, body: 16, lead: 22, title: 32, hero: 48 },
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
    `--bone-bright: ${palette.boneBright}`,
    `--ink: ${palette.ink}`,
    `--ink-dim: ${palette.inkDim}`,
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
