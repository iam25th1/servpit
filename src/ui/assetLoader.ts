// Real preload with real progress. The boot screen reports how many assets
// have actually decoded, never a timer pretending to be one.

import type { Manifest } from "@/render/manifest";

export interface LoadProgress {
  loaded: number;
  total: number;
  /** 0 to 1. */
  fraction: number;
  /** What is decoding right now, for the boot line. */
  current: string;
}

/** Every image the app needs, in the order it becomes visible. */
export function preloadList(manifest: Manifest): string[] {
  const ui = manifest.ui.filter((u) => u.kind !== "font").map((u) => u.path);
  const facesets = manifest.entries.map((e) => e.facesetPath);
  const sprites = manifest.entries.flatMap((e) => Object.values(e.sprites).map((s) => s.path));
  const fx = manifest.fx.map((f) => f.path);
  // Dedupe while keeping order: UI first, because it is what the boot screen
  // and the title need before anything else can render.
  return [...new Set([...ui, ...facesets, ...sprites, ...fx])];
}

function decode(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`failed to load ${path}`));
    image.src = path;
  });
}

/**
 * Loads every asset, reporting progress as each one finishes. Concurrency is
 * capped so the progress bar advances steadily rather than sitting at zero and
 * then jumping to full.
 */
export async function preloadAssets(manifest: Manifest, onProgress: (p: LoadProgress) => void, concurrency = 6): Promise<void> {
  const paths = preloadList(manifest);
  const total = paths.length;
  let loaded = 0;
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < paths.length) {
      const path = paths[cursor++];
      try {
        await decode(path);
      } catch {
        // A single missing sprite must not strand the boot screen. The
        // manifest parser already refused anything malformed, and the loader
        // proper will fail loudly when it tries to slice it.
      }
      loaded++;
      onProgress({ loaded, total, fraction: total === 0 ? 1 : loaded / total, current: path.split("/").pop() ?? path });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, total)) }, worker));
}
