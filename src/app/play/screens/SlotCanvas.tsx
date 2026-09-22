"use client";

// The slot canvas, and what the pointer is over.
//
// Its own file for a reason the guard in src/ui/tokens.test.ts enforces: a
// file that handles pointer movement and also animates is how pointer driven
// parallax gets in, and parallax is the vestibular failure this project bans.
// Nothing here animates anything. It reads a point, asks what symbol is drawn
// there, and shows the name. No animejs, no transform, no motion at all.

import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useEffect, useState } from "react";
import { wholePixelWidth } from "@/ui/layoutMode";
import styles from "./shell.module.css";

/**
 * Sizes a pixel canvas to a whole number of device pixels per source pixel.
 *
 * On the fixed stage a canvas is shown at its own size and the stage scale is
 * whole, so nothing is resampled. On a phone the width is whatever the phone
 * is, and a canvas stretched to it lands source pixels on fractions of device
 * pixels, which is how pixel art turns to mush. This picks the largest whole
 * multiple that fits and leaves the rest as margin.
 *
 * Off on the desktop stage, where the stage already does this.
 */
export function usePixelFit(ref: RefObject<HTMLCanvasElement | null>, enabled: boolean): void {
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (!enabled) {
      canvas.style.width = "";
      canvas.style.height = "";
      return;
    }
    const fit = (): void => {
      const parent = canvas.parentElement;
      if (!parent || canvas.width === 0) return;
      const room = parent.clientWidth;
      const width = wholePixelWidth(canvas.width, room, window.devicePixelRatio || 1);
      // Nothing whole fits on a one to one screen, so fill the width and take
      // the soft edges over a canvas wider than the phone.
      canvas.style.width = width === null ? "100%" : `${width}px`;
      canvas.style.height = "auto";
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, [ref, enabled]);
}

export interface SlotCanvasProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  hidden: boolean;
  /** The symbol drawn at this point of the canvas, in logical pixels, or null. */
  probeSymbol: (x: number, y: number) => string | null;
  /** What to call that symbol on screen, or null when it has no name. */
  labelFor: (symbol: string) => string | null;
  /** True on a phone, where the canvas has to fit the width it is given. */
  fitToWidth: boolean;
}

export function SlotCanvas({ canvasRef, hidden, probeSymbol, labelFor, fitToWidth }: SlotCanvasProps) {
  const [tip, setTip] = useState<{ label: string; x: number; y: number } | null>(null);
  usePixelFit(canvasRef, fitToWidth);

  const read = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // The canvas is drawn in logical pixels and shown at whatever size the
    // stage scaled it to, so the point is converted rather than assumed.
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const symbol = probeSymbol(x, y);
    const label = symbol ? labelFor(symbol) : null;
    setTip(label ? { label, x: canvas.offsetLeft + event.nativeEvent.offsetX, y: canvas.offsetTop + event.nativeEvent.offsetY } : null);
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`${styles.canvas} ${hidden ? styles.hidden : ""}`}
        role="img"
        aria-label="Slot machine"
        onPointerMove={read}
        onPointerDown={read}
        onPointerLeave={() => setTip(null)}
      />
      {tip && (
        <span className={styles.tip} style={{ left: tip.x, top: tip.y }} role="status">
          {tip.label}
        </span>
      )}
    </>
  );
}
