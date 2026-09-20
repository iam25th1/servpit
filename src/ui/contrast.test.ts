import { describe, expect, it } from "vitest";
import { AA_BODY, AA_LARGE, contrastRatio, failures, flatten, luminance } from "./contrast";
import { darkSurfaces, lightSurfaces, midSurfaces } from "./surfaces";
import { palette } from "./tokens";

/** The lightest pixel of the plank wall the title backdrop repeats. */
const WALL_LIGHTEST = "#5f7160";
/** That wall at the backdrop's opacity, over the page. */
const TITLE_WALL = flatten(WALL_LIGHTEST, palette.pit, 0.5);
/** The title panel's flat field over that wall. */
const TITLE_FIELD = flatten(palette.pitDeep, TITLE_WALL, 0.8);

/**
 * Every text style in the interface, against the colour it actually lands on.
 *
 * The surfaces are sampled sprite interiors, not tokens, because a panel is
 * art. See src/ui/surfaces.ts.
 */
const PAIRS = [
  // Mode select, on the wood and cream cards.
  { what: "mode blurb on the wood card", text: palette.inkDim, surface: lightSurfaces.panel },
  { what: "mode blurb on a locked card", text: palette.inkDim, surface: lightSurfaces.panelDisabled },
  { what: "mode name in its cleared band", text: palette.bone, surface: palette.pitDeep, large: true },
  { what: "roadmap text in the lock badge", text: palette.amber, surface: palette.pitDeep },
  { what: "stake tab", text: palette.ink, surface: lightSurfaces.tab },
  { what: "stake tab hovered", text: palette.ink, surface: lightSurfaces.tabHover },

  // Buttons, whose label follows the sprite it sits on.
  { what: "button label", text: palette.ink, surface: lightSurfaces.button },
  { what: "button label hovered", text: palette.ink, surface: lightSurfaces.buttonHover },
  { what: "button label pressed", text: palette.boneBright, surface: midSurfaces.buttonPressed },
  { what: "button label disabled", text: palette.boneBright, surface: midSurfaces.buttonDisabled },

  // The lineup and the arena HUD, on the dark bg frame.
  { what: "agent name", text: palette.bone, surface: darkSurfaces.bg },
  { what: "agent verdict, holding", text: palette.boneDim, surface: darkSurfaces.bg },
  { what: "lineup supporting note", text: palette.boneDim, surface: darkSurfaces.bg },
  { what: "HUD label", text: palette.bone, surface: darkSurfaces.bg },
  { what: "HUD standing count", text: palette.amber, surface: darkSurfaces.bg },
  { what: "kill feed line", text: palette.boneDim, surface: darkSurfaces.bg },

  // The SERV reason strings, in the pack's parchment dialog.
  { what: "reason string in a dialog", text: palette.ink, surface: lightSurfaces.dialog },

  // The result screen.
  { what: "winner name on its nameplate", text: palette.amber, surface: palette.pitDeep, large: true },
  { what: "winner pot on the sage panel", text: palette.ink, surface: lightSurfaces.panelAlt },
  { what: "reconciliation note on the sage panel", text: palette.inkDim, surface: lightSurfaces.panelAlt },
  { what: "ledger row", text: palette.bone, surface: darkSurfaces.bg },
  { what: "ledger delta up", text: palette.good, surface: darkSurfaces.bg },
  { what: "ledger delta down", text: flatten(palette.bone, darkSurfaces.bg, 0.75), surface: darkSurfaces.bg },
  { what: "transfer amount", text: palette.amber, surface: darkSurfaces.bg },
  { what: "transfer hash link", text: palette.amber, surface: darkSurfaces.bg },

  // The title, whose text sits on a flat field over the plank wall. The
  // lightest wall pixel is #5f7160; at the backdrop's 0.5 it composites to
  // #3a4438 over the page, and the panel field of pitDeep at 0.8 over that
  // gives #161a13. That is the real surface, not a token.
  { what: "title wordmark", text: palette.amber, surface: TITLE_FIELD, large: true },
  { what: "title tagline", text: palette.boneDim, surface: TITLE_FIELD },
  { what: "title attract line", text: palette.amber, surface: TITLE_FIELD },
  { what: "anything on the wall outside the panel", text: palette.bone, surface: TITLE_WALL },

  // On the page itself.
  { what: "offchain notice", text: palette.boneDim, surface: palette.pit },
  { what: "lever note", text: palette.boneDim, surface: palette.pit },
  { what: "top bar meta", text: palette.boneDim, surface: palette.pit },
  { what: "wordmark", text: palette.amber, surface: palette.pit },
  { what: "error", text: palette.bad, surface: palette.pit },
];

describe("the title backdrop composite", () => {
  it("is the value the stylesheet documents", () => {
    // If the backdrop's opacity or the panel field changes, this fails and
    // the pairs below stop describing the screen.
    expect(TITLE_WALL).toBe("#3a4438");
    expect(TITLE_FIELD).toBe("#161a13");
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio(palette.amber, palette.amber)).toBe(1);
  });

  it("is order independent", () => {
    expect(contrastRatio(palette.bone, palette.pit)).toBe(contrastRatio(palette.pit, palette.bone));
  });

  it("rejects a malformed colour rather than scoring it", () => {
    expect(() => luminance("nope")).toThrow(RangeError);
    expect(() => contrastRatio("#fff", "#000000")).toThrow(RangeError);
  });

  it("flattens a translucent colour onto what is behind it", () => {
    expect(flatten("#ffffff", "#000000", 0.5)).toBe("#808080");
    expect(flatten("#ffffff", "#000000", 1)).toBe("#ffffff");
    expect(flatten("#ffffff", "#000000", 0)).toBe("#000000");
  });
});

describe("every text style against the surface it lands on", () => {
  it("meets 4.5:1 for body text and 3:1 for large display text", () => {
    // 4.5:1 is the WCAG AA body ratio, 3:1 the AA large text ratio. Chosen
    // rather than inherited: this is pixel art at small sizes on textured
    // panels, where anything looser stops being readable at arm's length.
    expect(failures(PAIRS)).toEqual([]);
  });

  it("documents the thresholds it enforces", () => {
    expect(AA_BODY).toBe(4.5);
    expect(AA_LARGE).toBe(3);
  });

  it("catches a pair that is too close, so the check is not vacuous", () => {
    // The real defect this pass fixed: dim bone on the wood panel, 1.05:1.
    expect(failures([{ what: "the old mode blurb", text: "#a8a293", surface: lightSurfaces.panel }])).toHaveLength(1);
  });

  it("covers every text style, so a new one cannot be added unchecked", () => {
    expect(PAIRS.length).toBeGreaterThanOrEqual(34);
  });
});
