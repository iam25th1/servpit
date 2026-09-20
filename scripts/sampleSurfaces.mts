// Prints the dominant interior colour of each ui nine patch, which is what
// src/ui/surfaces.ts records and the contrast test checks text against.
//
// Run: npx tsx scripts/sampleSurfaces.mts
import { readFileSync } from "node:fs";
import sharp from "sharp";

interface Def { id: string; path: string }

const manifest: unknown = JSON.parse(readFileSync("public/assets/manifest.json", "utf8"));
const defs: Def[] = [];
const walk = (node: unknown): void => {
  if (Array.isArray(node)) { node.forEach(walk); return; }
  if (node === null || typeof node !== "object") return;
  const rec = node as Record<string, unknown>;
  if (typeof rec.id === "string" && typeof rec.path === "string") defs.push({ id: rec.id, path: rec.path });
  Object.values(rec).forEach(walk);
};
walk(manifest);

const WANTED = ["panel", "panelAlt", "panelDisabled", "bg", "bgAlt", "button", "buttonHover", "buttonPressed", "buttonDisabled", "tab", "tabHover", "dialogSimple", "facesetBox"];

for (const id of WANTED) {
  const def = defs.find((d) => d.id === id);
  if (!def) { console.log(`${id}: not in the manifest`); continue; }
  const { data, info } = await sharp(`public${def.path}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Middle third, so the sample is interior rather than border.
  const x0 = Math.floor(info.width / 3);
  const x1 = Math.ceil((info.width * 2) / 3);
  const y0 = Math.floor(info.height / 3);
  const y1 = Math.ceil((info.height * 2) / 3);
  const counts = new Map<string, number>();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3] < 250) continue;
      const hex = `#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`${id.padEnd(16)} ${top.map(([hex, n]) => `${hex} ${Math.round((n / total) * 100)}%`).join("  ")}`);
}
