// The quiet screen is one block, not two objects sharing a stage.
//
// The card and Marrow's panel used to sit side by side, centred on each other
// and on nothing else: a 304 tall card beside a 122 tall panel lines up on no
// edge a reader can see. jsdom cannot measure that, so what is held here is
// the decision behind it, which is that both panels take their width from one
// place and the screen stacks them.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const shell = readFileSync(join(process.cwd(), "src/app/play/screens/shell.module.css"), "utf8");

function rule(selector: string): string {
  const start = shell.indexOf(`${selector} {`);
  expect(start, `${selector} is gone`).toBeGreaterThan(0);
  return shell.slice(start, shell.indexOf("}", start));
}

describe("the resting and paused screen", () => {
  it("stacks the card and the bank rather than standing them side by side", () => {
    expect(rule(".resting")).toMatch(/flex-direction: column/);
    expect(rule(".resting")).toMatch(/align-items: center/);
  });

  it("gives both panels the same width, from one declaration", () => {
    expect(rule(".resting")).toMatch(/--rest-width:\s*\d+px/);
    expect(rule(".restCard")).toMatch(/width: var\(--rest-width\)/);
    expect(rule(".restBank")).toMatch(/width: var\(--rest-width\)/);
  });

  it("still lets a phone take the full width", () => {
    const phone = shell.slice(shell.indexOf('.shell[data-layout="portrait"]'));
    expect(phone).toMatch(/\.shell\[data-layout="portrait"\] \.restCard[\s\S]{0,260}width: 100%/);
  });
});
