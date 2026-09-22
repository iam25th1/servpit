"use client";

// The slot canvas, and what the pointer is over.
//
// Its own file for a reason the guard in src/ui/tokens.test.ts enforces: a
// file that handles pointer movement and also animates is how pointer driven
// parallax gets in, and parallax is the vestibular failure this project bans.
// Nothing here animates anything. It reads a point, asks what symbol is drawn
// there, and shows the name. No animejs, no transform, no motion at all.

import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useState } from "react";
import styles from "./shell.module.css";

export interface SlotCanvasProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  hidden: boolean;
  /** The symbol drawn at this point of the canvas, in logical pixels, or null. */
  probeSymbol: (x: number, y: number) => string | null;
  /** What to call that symbol on screen, or null when it has no name. */
  labelFor: (symbol: string) => string | null;
}

export function SlotCanvas({ canvasRef, hidden, probeSymbol, labelFor }: SlotCanvasProps) {
  const [tip, setTip] = useState<{ label: string; x: number; y: number } | null>(null);

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
