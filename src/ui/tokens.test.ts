import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { palette, space, timing, tokensToCss, type, uiScale } from "./tokens";

const hue = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return -1;
  const d = max - min;
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};

const everyColour = (): string[] => {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) out.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(palette);
  return out;
};

describe("palette", () => {
  it("paints nothing in the purple range", () => {
    for (const colour of everyColour()) {
      const h = hue(colour);
      expect(h < 255 || h > 335, `palette holds ${colour}`).toBe(true);
    }
  });

  it("agrees with the arena tier colours, so a rare reads rare on every surface", () => {
    expect(palette.tier.rare).toBe(palette.amber);
    expect(everyColour().length).toBeGreaterThan(10);
  });
});

describe("scales", () => {
  it("builds spacing on 4, because the art is 16 px pixel art", () => {
    for (const value of Object.values(space)) expect(value % 2).toBe(0);
    expect(space.base % 4).toBe(0);
  });

  it("scales pixel art by a whole number only", () => {
    expect(Number.isInteger(uiScale)).toBe(true);
    expect(uiScale).toBeGreaterThanOrEqual(1);
  });

  it("orders the type scale and never names a serif", () => {
    const sizes = Object.values(type.size);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
    for (const family of Object.values(type.family)) {
      // One of the two faces this project ships, and nothing a system might
      // substitute: the fallback is a monospace, never a serif.
      expect(family).toMatch(/Tiny5|ServpitNormal/);
      expect(family).not.toMatch(/serif|Georgia|Times|Palatino|Iowan/i);
    }
  });

  it("keeps the screen transition long enough to overlap two staggers", () => {
    expect(timing.screen).toBeGreaterThan(timing.move);
    expect(timing.overlap).toBeLessThan(0);
    expect(Math.abs(timing.overlap)).toBeLessThan(timing.screen);
  });
});

describe("tokensToCss", () => {
  it("emits every palette, spacing, size and timing value as a custom property", () => {
    const css = tokensToCss();
    expect(css).toContain(`--amber: ${palette.amber}`);
    for (const name of Object.keys(space)) expect(css).toContain(`--space-${name}`);
    for (const name of Object.keys(type.size)) expect(css).toContain(`--text-${name}`);
    for (const name of Object.keys(timing)) expect(css).toContain(`--time-${name}`);
  });
});

describe("no serif is reachable anywhere in the app", () => {
  const cssFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".css")) out.push(p);
      }
    };
    walk(join(process.cwd(), "src"));
    return out;
  };

  it("no stylesheet sizes or spaces anything from the viewport", () => {
    // The game renders into a fixed 1280x720 stage that is scaled to fit, so
    // a viewport unit makes the same composition different on two displays.
    // The title used clamp(38px, 11vw, ...) for the wordmark and a 6vmin
    // vignette inset, and the shell used 100dvh before the stage landed.
    const offenders: string[] = [];
    for (const file of cssFiles()) {
      readFileSync(file, "utf8")
        .split("\n")
        // A comment may name the unit it is explaining.
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
        .forEach((line, i) => {
          if (/\b[0-9.]+(vw|vh|vmin|vmax|dvh|dvw|svh|lvh)\b/.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("no stylesheet names a serif family or falls back to one", () => {
    const offenders: string[] = [];
    for (const file of cssFiles()) {
      const body = readFileSync(file, "utf8");
      for (const line of body.split("\n")) {
        if (!/font-family/.test(line)) continue;
        if (/\bserif\b|Georgia|Times|Palatino|Iowan|Book Antiqua/i.test(line)) offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every stylesheet that sets a family routes through the token", () => {
    const offenders: string[] = [];
    for (const file of cssFiles()) {
      const body = readFileSync(file, "utf8");
      for (const line of body.split("\n")) {
        if (!/font-family:/.test(line)) continue;
        // The @font-face blocks name the faces themselves; everything else
        // goes through a token.
        if (/ServpitNormal|Tiny5/.test(line) || /var\(--font-(ui|display)\)/.test(line)) continue;
        offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("anime.js and the canvas Timeline never animate the same element", () => {
  const sources = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
      }
    };
    walk(join(process.cwd(), "src"));
    return out;
  };

  it("nothing outside src/render imports the canvas render loop or a canvas renderer for animation", () => {
    // The canvas side owns reels and arena playback and only ever draws to a
    // CanvasDrawTarget. The DOM side owns chrome and only ever targets an
    // HTMLElement. The separation is enforced by where each import may appear.
    const offenders: string[] = [];
    for (const file of sources()) {
      if (file.includes("/src/render/")) continue;
      const body = readFileSync(file, "utf8");
      const usesAnime = /from "animejs/.test(body);
      const drawsCanvas = /CanvasDrawTarget|\.beginFrame\(|drawSlice\(/.test(body);
      // A file may wire both, as the client does, but it must not hand a
      // canvas to anime.js.
      if (usesAnime && /animate\(\s*\w*[Cc]anvas/.test(body)) offenders.push(`${file}: animates a canvas element`);
      if (drawsCanvas && /animate\(.*canvasRef/.test(body)) offenders.push(`${file}: anime.js targets a canvas ref`);
    }
    expect(offenders).toEqual([]);
  });

  it("no anime.js call targets a canvas selector", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const body = readFileSync(file, "utf8");
      if (!/from "animejs/.test(body)) continue;
      if (/animate\(\s*["'`][^"'`]*canvas/i.test(body)) offenders.push(file);
      if (/querySelectorAll?\(\s*["'`]canvas/i.test(body) && /animate\(/.test(body)) offenders.push(`${file}: selects canvases near an animate call`);
    }
    expect(offenders).toEqual([]);
  });

  it("the canvas renderers never import anime.js", () => {
    const offenders = sources()
      .filter((f) => f.includes("/src/render/"))
      .filter((f) => /from "animejs/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("vestibular safety in the animation layer", () => {
  const animFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) && /from "animejs/.test(readFileSync(p, "utf8"))) out.push(p);
      }
    };
    walk(join(process.cwd(), "src"));
    return out;
  };

  it("no animation touches rotation, blur, or any full screen container", () => {
    const banned = [/rotate\s*:/, /rotateX|rotateY|rotateZ/, /filter\s*:\s*["'`]?blur/, /blur\(/, /skew/, /perspective/];
    const offenders: string[] = [];
    for (const file of animFiles()) {
      const body = readFileSync(file, "utf8");
      for (const re of banned) if (re.test(body)) offenders.push(`${file}: ${re}`);
      // Nothing may animate the document scroller or the page body.
      if (/animate\(\s*(document\.body|document\.documentElement|window)/.test(body)) offenders.push(`${file}: animates the page itself`);
    }
    expect(offenders).toEqual([]);
  });

  it("no pointer driven parallax anywhere", () => {
    const offenders = animFiles().filter((f) => {
      const body = readFileSync(f, "utf8");
      return /pointermove|mousemove/i.test(body) && /animate\(|utils\.set\(/.test(body);
    });
    expect(offenders).toEqual([]);
  });
});

describe("no gradients anywhere in the stylesheets", () => {
  it("no stylesheet uses a gradient function", () => {
    // The house rule bans gradients. This existed only as a rule until a
    // repeating-linear-gradient shipped in the locked card slats and survived
    // a phase, because the hue test reads palette tokens and never looked at
    // CSS functions.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".css")) {
          const body = readFileSync(p, "utf8");
          for (const line of body.split("\n")) {
            if (/\b(linear|radial|conic|repeating-linear|repeating-radial)-gradient\s*\(/.test(line)) {
              offenders.push(`${p}: ${line.trim()}`);
            }
          }
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });

  it("no component sets a gradient through an inline style", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) {
          if (/-gradient\s*\(/.test(readFileSync(p, "utf8"))) offenders.push(p);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});

describe("globals.css and the token module", () => {
  const globals = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
  const root = globals.slice(globals.indexOf(":root {"), globals.indexOf("}", globals.indexOf(":root {")));

  it("declares every token the module produces, with the same value", () => {
    // These two had silently drifted: globals.css is what the browser reads,
    // tokensToCss was called by nothing but its own test, so raising a size or
    // a colour in the module changed nothing on screen.
    const missing = tokensToCss()
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((decl) => !root.includes(decl.endsWith(";") ? decl : `${decl};`));
    expect(missing).toEqual([]);
  });
});
