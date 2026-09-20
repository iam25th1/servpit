import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRng } from "./rng";

const DRAWS = 10_000;

function draws(seed: string, n = DRAWS): number[] {
  const rng = createRng(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rng.nextU32());
  return out;
}

describe("createRng", () => {
  it("same seed gives the same 10,000 draws twice in one process", () => {
    expect(draws("servpit-seed")).toEqual(draws("servpit-seed"));
  });

  it("same seed gives the same 10,000 draws in a fresh process", () => {
    const seed = "fresh-process-seed";
    const r = spawnSync(
      process.execPath,
      ["--import", "tsx", "test/helpers/rng-dump.ts", seed, String(DRAWS)],
      { cwd: process.cwd(), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    expect(r.status, r.stderr).toBe(0);
    const fresh = r.stdout.trim().split(",").map(Number);
    expect(fresh).toEqual(draws(seed));
  });

  it("different seeds diverge", () => {
    expect(draws("a", 16)).not.toEqual(draws("b", 16));
  });

  it("empty and single character seeds still produce full range output", () => {
    const seen = new Set(draws("", 1000));
    expect(seen.size).toBeGreaterThan(990);
  });

  it("every u32 draw is an integer in [0, 2^32)", () => {
    for (const v of draws("range", 5000)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(0x1_0000_0000);
    }
  });

  it("rejects a non string seed", () => {
    expect(() => createRng(42 as unknown as string)).toThrow(TypeError);
  });
});

describe("nextInt", () => {
  it("stays inside [0, max) and hits every value for a small max", () => {
    const rng = createRng("bounds");
    const hits = new Array<number>(7).fill(0);
    for (let i = 0; i < 7000; i++) {
      const v = rng.nextInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      hits[v]++;
    }
    for (const h of hits) expect(h).toBeGreaterThan(800);
  });

  it("returns 0 when max is 1", () => {
    const rng = createRng("one");
    for (let i = 0; i < 100; i++) expect(rng.nextInt(1)).toBe(0);
  });

  it("rejects max that is zero, negative, fractional, NaN or above 2^32", () => {
    const rng = createRng("bad");
    for (const bad of [0, -1, 1.5, Number.NaN, 0x1_0000_0001, Infinity]) {
      expect(() => rng.nextInt(bad)).toThrow(RangeError);
    }
  });
});

describe("engine source hygiene", () => {
  it("src/engine never references Math.random, Date or performance.now", () => {
    const banned = [/Math\.random/, /Date\.now/, /new Date\b/, /performance\.now/];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) {
          const body = readFileSync(p, "utf8");
          if (banned.some((re) => re.test(body))) offenders.push(p);
        }
      }
    };
    walk(join(process.cwd(), "src/engine"));
    expect(offenders).toEqual([]);
  });
});
