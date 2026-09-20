"use client";

// Boot. The progress bar is the pack's own LifeBarMini pair and it reports
// how many assets have actually decoded. No timer pretends to be a loader.

import { useEffect, useRef, useState } from "react";
import type { Manifest } from "@/render/manifest";
import { Meter } from "@/ui/Meter";
import { NinePatch } from "@/ui/NinePatch";
import { PlankWall } from "@/ui/PlankWall";
import { preloadAssets, type LoadProgress } from "@/ui/assetLoader";
import styles from "./boot.module.css";

export interface BootScreenProps {
  manifest: Manifest;
  onReady: () => void;
}

export function BootScreen({ manifest, onReady }: BootScreenProps) {
  const [progress, setProgress] = useState<LoadProgress>({ loaded: 0, total: 0, fraction: 0, current: "" });
  const [error, setError] = useState<string | null>(null);
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await preloadAssets(manifest, (p) => {
          if (!cancelled) setProgress(p);
        });
        if (!cancelled) readyRef.current();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manifest]);

  return (
    <main className={styles.boot} data-screen="boot">
      {/* The same wall the title stands on, so the two screens are one place
          rather than a panel floating in a void. */}
      <PlankWall />
      <div className={styles.inner}>
        <NinePatch sprite="panel" data-anim="boot-panel" className={styles.panel}>
          {/* Amber is lamplight and does not read on the wood panel, where it
              measured 1.7:1. The wordmark gets a cleared band, the way a
              locked mode card's title does. */}
          <h1 className={styles.wordmark}>SERVPIT</h1>
          <div className={styles.barHolder} style={{ justifyContent: "center", marginTop: "var(--space-base)" }}>
            {/* Sized to the panel, not to the sprite. At scale 8 the gauge
                was a token in the middle of a large field. */}
            <Meter value={progress.fraction} variant="mini" scale={14} label={`Loading, ${Math.round(progress.fraction * 100)} percent`} />
            <span className={styles.count} aria-live="off">
              {progress.loaded}/{progress.total}
            </span>
          </div>
          <p className={styles.line} aria-live="polite">
            {error ? "" : progress.current || "reading the manifest"}
          </p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </NinePatch>
      </div>
    </main>
  );
}
