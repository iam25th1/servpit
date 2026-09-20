// The colour every text style actually lands on.
//
// A nine patch is art, not a CSS colour, so the contrast of text on a panel
// cannot be read out of the token file. These are the dominant interior
// colours of the pack's own sprites, sampled from the middle third of each
// PNG by scripts/sampleSurfaces.mts. Re-run that script if the art changes.
//
// The split matters: the pack's panels are mostly light, and the palette was
// built dark. Bone on a light panel is what made the mode blurbs and the
// stake tabs unreadable.

/** Sprite interiors that are light. Text on these is ink. */
export const lightSurfaces = {
  /** panel.png, the wood card. The Battle Royale mode card. */
  panel: "#f38c4c",
  /** panelDisabled.png, pale cream. The locked mode cards. */
  panelDisabled: "#eecf9b",
  /** panelAlt.png, sage. The cabinet surround and the winner panel. */
  panelAlt: "#8d977f",
  /** button.png and buttonHover.png. */
  button: "#f06733",
  buttonHover: "#ffad55",
  /** tab.png and tabHover.png, the stake tabs. */
  tab: "#ffffff",
  tabHover: "#eecf9b",
  /** dialogSimple.png, the parchment the SERV reason strings render in. */
  dialog: "#f2eaf1",
} as const;

/** Sprite interiors that are dark. Text on these is bone or amber. */
export const darkSurfaces = {
  /** bg.png, the frame behind the lineup, the HUD, the ledger, the transfers. */
  bg: "#46402e",
  bgAlt: "#34312c",
  /** facesetBox.png. */
  facesetBox: "#141b1b",
} as const;

/**
 * Mid browns. Neither ink nor ordinary bone clears the threshold on these, so
 * the two button states that use them take the bright bone.
 */
export const midSurfaces = {
  buttonPressed: "#9b513c",
  buttonDisabled: "#755b3e",
} as const;

/**
 * The text colours for a sprite, as CSS custom property references.
 *
 * Every container in the app is a nine patch, so the container is the only
 * thing that knows what colour is behind its text. It sets these two, and the
 * styles below it read them instead of naming a colour themselves. That is
 * why a light panel and a dark frame can share one stylesheet.
 */
export function inkFor(sprite: string): { color: string; dim: string } {
  if (sprite in lightSurfaces) return { color: "var(--ink)", dim: "var(--ink-dim)" };
  if (sprite in midSurfaces) return { color: "var(--bone-bright)", dim: "var(--bone-bright)" };
  return { color: "var(--bone)", dim: "var(--bone-dim)" };
}
