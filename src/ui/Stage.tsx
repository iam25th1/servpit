"use client";

// Centres the fixed logical stage in the viewport and scales it to fit. The
// transform is a scale about the stage centre, applied once to a container
// that never moves: no translation of the viewport, no rotation, no blur.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { STAGE_HEIGHT, STAGE_WIDTH, fitStage, type StageFit } from "./stageFit";
import styles from "./stage.module.css";

export function Stage({ children }: { children: ReactNode }) {
  const [fit, setFit] = useState<StageFit>(() => fitStage(STAGE_WIDTH, STAGE_HEIGHT));
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
