"use client";

// Access to the pixel UI kit. The manifest already describes every sprite,
// its real size and its nine patch slice, so nothing here hardcodes a path or
// an inset; a component asks for an id and gets what extraction measured.

import { createContext, useContext, type ReactNode } from "react";
import type { Manifest, UiDef } from "@/render/manifest";

interface UiKitValue {
  manifest: Manifest;
  /** Throws rather than returning undefined: a missing sprite is a bug, not a blank. */
  ui(id: string): UiDef;
  emote(meaning: string): UiDef;
  modeIcon(modeId: string): UiDef;
  facesetPath(characterId: string): string;
  /**
   * A face with no fighter behind it. Marrow is the only one.
   *
   * Separate from facesetPath because the lender is deliberately not in the
   * roster: putting it there would give it a tier, a win rate and a place on
   * the reels, and it never enters the pit.
   */
  portraitPath(portraitId: string): string | null;
}

const UiKitContext = createContext<UiKitValue | null>(null);

export function UiKitProvider({ manifest, children }: { manifest: Manifest; children: ReactNode }) {
  const byId = new Map(manifest.ui.map((u) => [u.id, u]));
  const ui = (id: string): UiDef => {
    const found = byId.get(id);
    if (!found) throw new Error(`ui sprite ${id} is not in the manifest`);
    return found;
  };
  const value: UiKitValue = {
    manifest,
    ui,
    emote: (meaning) => ui(manifest.emotes[meaning] ?? `emote-${meaning}`),
    modeIcon: (modeId) => ui(manifest.modeIcons[modeId] ?? manifest.modeIcons.locked),
    portraitPath: (portraitId) => manifest.portraits?.find((p) => p.id === portraitId)?.facesetPath ?? null,
    facesetPath: (characterId) => {
      const entry = manifest.entries.find((e) => e.id === characterId);
      if (!entry) throw new Error(`no manifest entry for character ${characterId}`);
      return entry.facesetPath;
    },
  };
  return <UiKitContext.Provider value={value}>{children}</UiKitContext.Provider>;
}

export function useUiKit(): UiKitValue {
  const value = useContext(UiKitContext);
  if (!value) throw new Error("useUiKit needs a UiKitProvider above it");
  return value;
}
