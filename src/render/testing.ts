// Test helpers: the committed manifest parsed, and a fake ImageLoader whose
// decoded sizes come from the manifest grid (or an override table). Not
// used by the app; imported by render tests only.

import manifestJson from "../../public/assets/manifest.json";
import { loadAssets, type AssetStore, type DecodedImage, type ImageLoader } from "./assets";
import { parseManifest } from "./manifest";

export const testManifest = parseManifest(manifestJson);

export type SizeOverride = { width: number; height: number } | "missing";

export function createFakeLoader(overrides: Record<string, SizeOverride> = {}): { loader: ImageLoader; loads: string[] } {
  const loads: string[] = [];
  const sizes = new Map<string, { width: number; height: number }>();
  for (const e of testManifest.entries) {
    for (const s of Object.values(e.sprites)) sizes.set(s.path, { width: s.cols * s.frameWidth, height: s.rows * s.frameHeight });
  }
  for (const f of testManifest.fx) sizes.set(f.path, { width: f.cols * f.frameWidth, height: f.rows * f.frameHeight });
  for (const e of testManifest.entries) sizes.set(e.facesetPath, { width: testManifest.faceset.width, height: testManifest.faceset.height });
  // The arena tiles its floor from these, so they are decoded at boot too.
  for (const u of testManifest.ui) if (u.kind === "tileset") sizes.set(u.path, { width: u.width, height: u.height });
  const loader: ImageLoader = {
    async load(path) {
      loads.push(path);
      const o = overrides[path];
      if (o === "missing") throw new Error(`404 ${path}`);
      const size = o ?? sizes.get(path);
      if (!size) throw new Error(`no fake size for ${path}`);
      return { width: size.width, height: size.height, source: { path } };
    },
    whiten(image: DecodedImage) {
      return { width: image.width, height: image.height, source: { white: image.source } };
    },
  };
  return { loader, loads };
}

export function loadTestAssets(): Promise<AssetStore> {
  return loadAssets(testManifest, createFakeLoader().loader);
}
