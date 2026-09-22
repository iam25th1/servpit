// The rules a phone layout stands on.
//
// jsdom has no layout engine, so a test that mounts a screen cannot measure a
// touch target or catch a panel hanging four pixels off the side. What it can
// do is hold the stylesheet to the decisions the layout was designed around,
// so a later edit cannot quietly take one away. The pixels themselves are
// measured in a browser, at the sizes in mobile.test.tsx, and reported with
// the change.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const shell = readFileSync(join(root, "src/app/play/screens/shell.module.css"), "utf8");
const stage = readFileSync(join(root, "src/ui/stage.module.css"), "utf8");

/**
 * The smallest text the phone layout may show, in css pixels.
 *
 * Thirteen. Below that the pixel face loses the one pixel counters in a, e and
 * s at ordinary reading distance, and thirteen is what the micro step becomes
 * when the scale steps up for a phone. The desktop stage keeps twelve, where
 * the whole composition is nearer the eye and scaled whole.
 */
const MIN_PHONE_TEXT_PX = 13;

/** The smallest a control may be on a touch screen, in css pixels. */
const MIN_TOUCH_PX = 44;

/** The block of rules that only apply to a phone. */
function phoneRules(): string {
  const start = shell.indexOf('.shell[data-layout="portrait"]');
  expect(start, "the phone layout block is gone").toBeGreaterThan(0);
  return shell.slice(start);
}

describe("the phone layout's rules", () => {
  it("steps the type up rather than zooming the layout", () => {
    const block = phoneRules();
    const sizes = [...block.matchAll(/--text-(micro|small|body|lead|title|hero):\s*(\d+)px/g)].map(([, name, px]) => ({ name, px: Number(px) }));
    expect(sizes.length, "the phone scale is not set").toBeGreaterThanOrEqual(6);
    for (const size of sizes) {
      expect(size.px, `--text-${size.name} is below the documented minimum`).toBeGreaterThanOrEqual(MIN_PHONE_TEXT_PX);
    }
  });

  it("gives every control a touch target", () => {
    const block = phoneRules();
    const buttons = block.match(/\.shell\[data-layout="portrait"\] button[\s\S]{0,400}?\}/);
    expect(buttons, "no rule sizes a button for a thumb").not.toBeNull();
    expect(buttons?.[0]).toMatch(new RegExp(`min-height:\\s*${MIN_TOUCH_PX}px`));
    expect(block).toMatch(/input,\n\.shell\[data-layout="compact"\] input \{/);
  });

  it("keeps the keyboard from zooming the page on a phone", () => {
    // Anything under sixteen makes iOS zoom on focus, and a zoomed page is a
    // page that scrolls sideways with the keyboard open.
    const handle = phoneRules().match(/\.handleInput[\s\S]{0,400}?\}/);
    expect(handle?.[0]).toMatch(/font-size:\s*16px/);
  });

  it("never lets anything scroll sideways", () => {
    expect(stage).toMatch(/overflow-x:\s*hidden/);
    expect(phoneRules()).toMatch(/max-width:\s*100%/);
  });

  it("respects the notch and the home indicator", () => {
    expect(stage).toMatch(/env\(safe-area-inset-top\)/);
    expect(stage).toMatch(/env\(safe-area-inset-bottom\)/);
  });

  it("stacks the round rather than shrinking it", () => {
    const block = phoneRules();
    expect(block).toMatch(/\.playfield \{\n\s*display: flex;\n\s*flex-direction: column;/);
    // Sideways, the same design splits into two columns rather than going
    // back to a stage that needs 720 of height.
    expect(block).toMatch(/\.shell\[data-layout="compact"\] \.playfield \{[\s\S]{0,200}grid-template-columns/);
  });

  it("puts the pick above the cabinet while the window is open", () => {
    expect(phoneRules()).toMatch(/\[data-anim="backing"\][\s\S]{0,200}order: -1/);
  });

  it("leaves the desktop stage alone", () => {
    // Every phone rule is scoped to the attribute the stage sets. A rule that
    // is not would change the fixed composition too.
    const block = phoneRules();
    for (const line of block.split("\n")) {
      const selector = line.trim();
      if (!selector.endsWith("{") || selector.startsWith("/*") || selector.startsWith("*")) continue;
      expect(selector, "a phone rule that is not scoped to the phone layout").toMatch(/data-layout=|^\s*\}/);
    }
  });
});
