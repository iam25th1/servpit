// Pure helpers for the asset extraction script. Kept free of I/O so they
// can be unit tested without the zip.

import type { Tier } from "../../src/config/roster";

export interface PngSize {
  width: number;
  height: number;
}

export const EXPECTED = {
  faceset: 38,
  frame: 16,
  monsterSheet: 64,
} as const;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads width and height from a PNG IHDR chunk. Throws on anything that is not a PNG. */
export function readPngSize(buf: Buffer): PngSize {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG: bad signature or truncated");
  }
  if (buf.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("not a PNG: first chunk is not IHDR");
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function frameGrid(width: number, height: number, frameSize: number): { cols: number; rows: number } {
  if (width % frameSize !== 0 || height % frameSize !== 0) {
    throw new Error(`${width}x${height} is not a multiple of ${frameSize}x${frameSize}`);
  }
  return { cols: width / frameSize, rows: height / frameSize };
}

const PLAIN_PNG = /^[A-Za-z0-9_-]+\.png$/i;
const FACESET = /^faceset\.png$/i;

/** The single non Faceset png in a monster folder. Name and case vary across monsters. */
export function pickMonsterSheet(names: readonly string[]): string {
  const candidates = names.filter((n) => PLAIN_PNG.test(n) && !FACESET.test(n));
  if (candidates.length !== 1) {
    throw new Error(`expected exactly one sprite sheet, found ${candidates.length}: ${candidates.join(", ")}`);
  }
  return candidates[0];
}

export function isMacosxPath(p: string): boolean {
  return p.split("/").some((seg) => seg === "__MACOSX" || seg.startsWith("._"));
}

export interface DimensionReport {
  id: string;
  tier: Tier;
  faceset: PngSize;
  sheets: Record<string, PngSize>;
}

/** Human readable mismatches against the expected pack dimensions. Empty when all good. */
export function dimensionWarnings(r: DimensionReport): string[] {
  const out: string[] = [];
  const size = (s: PngSize) => `${s.width}x${s.height}`;
  if (r.faceset.width !== EXPECTED.faceset || r.faceset.height !== EXPECTED.faceset) {
    out.push(`${r.id}: Faceset.png is ${size(r.faceset)}, expected ${EXPECTED.faceset}x${EXPECTED.faceset}`);
  }
  for (const [name, s] of Object.entries(r.sheets)) {
    if (r.tier === "rare") {
      if (s.width !== EXPECTED.monsterSheet || s.height !== EXPECTED.monsterSheet) {
        out.push(`${r.id}: ${name} is ${size(s)}, expected ${EXPECTED.monsterSheet}x${EXPECTED.monsterSheet}`);
      }
    } else if (s.width % EXPECTED.frame !== 0 || s.height % EXPECTED.frame !== 0) {
      out.push(`${r.id}: ${name} is ${size(s)}, expected multiples of ${EXPECTED.frame}x${EXPECTED.frame}`);
    }
  }
  return out;
}
