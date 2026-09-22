"use client";

// Centres the fixed logical stage in the viewport and scales it to fit. The
// transform is a scale about the stage centre, applied once to a container
// that never moves: no translation of the viewport, no rotation, no blur.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { STAGE_HEIGHT, STAGE_WIDTH, fitStage, type StageFit } from "./stageFit";
import { layoutFor, type LayoutMode } from "./layoutMode";
import styles from "./stage.module.css";

/**
 * The layout this viewport is in, watched.
 *
 * Exported because the screens ask for it too: a phone gets a different
 * arrangement rather than the same one scaled down, and the components that
 * draw canvases need to know which they are in.
 */
export function useLayoutMode(): LayoutMode {
  // Desktop until the browser says otherwise, which is also what the server
  // renders: the phone layout arrives on the first measure, before paint.
  const [mode, setMode] = useState<LayoutMode>("desktop");
  useEffect(() => {
    const measure = (): void => setMode(layoutFor(window.innerWidth, window.innerHeight));
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);
  return mode;
}

export function Stage({ children }: { children: ReactNode }) {
  const [fit, setFit] = useState<StageFit>(() => fitStage(STAGE_WIDTH, STAGE_HEIGHT));
  const mode = useLayoutMode();
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const measure = (): void => setFit(fitStage(window.innerWidth, window.innerHeight));
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  // A phone does not get the stage. It gets the viewport, with the screens
  // arranged for it, because a 1280 by 720 composition fits a phone at about
  // a third and nothing on it can be read at a third.
  if (mode !== "desktop") {
    return (
      <div className={styles.fluid} data-layout={mode}>
        {children}
      </div>
    );
  }

  return (
    <div className={styles.letterbox} data-stage-scale={fit.scale.toFixed(3)} data-stage-fractional={String(fit.fractional)}>
      {/* The frame carries the scaled size, so the centring is done on the
          size the stage actually occupies. Scaling about the centre of a box
          that is still 1280 wide leaves the layout box overflowing, and the
          grid then aligns the unscaled box: at a 0.9375 fit the stage landed
          40 px right of centre and its right hand column was clipped. */}
      <div className={styles.frame} style={{ width: fit.width, height: fit.height }}>
        <div
          ref={frameRef}
          className={styles.stage}
          style={{
            width: STAGE_WIDTH,
            height: STAGE_HEIGHT,
            transform: `scale(${fit.scale})`,
            transformOrigin: "top left",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
