"use client";

// Boot. The progress bar is the pack's own LifeBarMini pair and it reports
// how many assets have actually decoded. No timer pretends to be a loader.

import { useEffect, useRef, useState } from "react";
import type { Manifest } from "@/render/manifest";
import { Meter } from "@/ui/Meter";
import { NinePatch } from "@/ui/NinePatch";
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
      <div className={styles.inner}>
        <NinePatch sprite="panel" data-anim="boot-panel" style={{ width: "100%" }}>
          <h1 className={styles.wordmark}>SERVPIT</h1>
          <div className={styles.barHolder} style={{ justifyContent: "center", marginTop: "var(--space-base)" }}>
            <Meter value={progress.fraction} variant="mini" scale={8} label={`Loading, ${Math.round(progress.fraction * 100)} percent`} />
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
