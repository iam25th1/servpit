// The quiet screen is two blocks with shared edges, not objects sharing a stage.
//
// The card and Marrow's panel used to sit side by side, centred on each other
// and on nothing else: a 304 tall card beside a 122 tall panel lines up on no
// edge a reader can see. They are one stacked block now, at one width, and
// the calls panel stands beside that block at its full height. jsdom cannot
// measure any of that, so what is held here is the decision behind it.

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
  it("puts the pit and the calls side by side, with one top edge and one bottom edge", () => {
    expect(rule(".resting")).toMatch(/flex-direction: row/);
    expect(rule(".resting")).toMatch(/align-items: stretch/);
  });

  it("stacks the card and the bank rather than standing them side by side", () => {
    expect(rule(".restMain")).toMatch(/flex-direction: column/);
    expect(rule(".restMain")).toMatch(/align-items: center/);
  });

  it("gives the card and the bank the same width, from one declaration", () => {
    expect(rule(".resting")).toMatch(/--rest-width:\s*\d+px/);
    expect(rule(".restCard")).toMatch(/width: var\(--rest-width\)/);
    expect(rule(".restBank")).toMatch(/width: var\(--rest-width\)/);
  });

  it("lets the calls take the width the stage has left, and no more than a row reads well at", () => {
    expect(rule(".restCalls")).toMatch(/flex: 1/);
    expect(rule(".restCalls")).toMatch(/max-width: \d+px/);
  });

  it("still lets a phone take the full width, with the calls straight after the card", () => {
    const phone = shell.slice(shell.indexOf('.shell[data-layout="portrait"]'));
    expect(phone).toMatch(/\.shell\[data-layout="portrait"\] \.restCard[\s\S]{0,260}width: 100%/);
    expect(phone).toMatch(/\.shell\[data-layout="portrait"\] \.restMain[\s\S]{0,120}display: contents/);
    expect(phone).toMatch(/\.shell\[data-layout="portrait"\] \.restCalls[\s\S]{0,120}order: 1/);
  });
});
