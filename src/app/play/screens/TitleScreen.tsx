"use client";

// Title. Three things happen on entry and they are one timeline, not three
// animations: the frame border draws itself, the wordmark splits and staggers
// in, and the actions arrive underneath.
//
// Everything animated is element local: per character opacity and offset, and
// an SVG stroke offset. The backdrop is a static tiled field that never moves.

import { animate, createTimeline, stagger, utils } from "animejs";
import { createDrawable } from "animejs/svg";
import { split } from "animejs/text";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/ui/Button";
import { useUiKit } from "@/ui/UiKit";
import { timing } from "@/ui/tokens";
import styles from "./title.module.css";

/**
 * The cell of tilesetRelief the backdrop repeats. Exported so the contrast
 * test can compute what the title's text actually lands on: the wall shows
 * through the panel field, so the surface is a composite rather than a token.
 */
export const WALL_TILE = { x: 5, y: 1 } as const;

export interface TitleScreenProps {
  onStart: () => void;
}

export function TitleScreen({ onStart }: TitleScreenProps) {
  const { ui } = useUiKit();
  const rootRef = useRef<HTMLElement>(null);
  const wordmarkRef = useRef<HTMLHeadingElement>(null);
  const frameRef = useRef<SVGRectElement>(null);
  const attractRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const wordmark = wordmarkRef.current;
    const frame = frameRef.current;
    if (!root || !wordmark || !frame) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Split the wordmark into characters so each can arrive on its own beat.
    const letters = split(wordmark, { chars: true });
    const drawable = createDrawable(frame);

    const timeline = createTimeline({ defaults: { ease: "outQuad" } })
      .add(drawable, { draw: ["0 0", "0 1"], duration: 900, ease: "inOutQuad" })
      .add(
        letters.chars,
        { opacity: [0, 1], y: [14, 0], scale: [0.86, 1], duration: timing.move, delay: stagger(46) },
        "-=620",
      )
      .add(root.querySelectorAll("[data-anim='title-late']"), { opacity: [0, 1], y: [10, 0], duration: timing.move, delay: stagger(timing.stagger) }, "-=180");

    // Attract state: a slow pulse on the prompt only. One element, opacity
    // only, nothing that moves the page.
    const attract = attractRef.current
      ? animate(attractRef.current, { opacity: [1, 0.35], duration: 1100, alternate: true, loop: true, ease: "inOutSine" })
      : null;

    return () => {
      timeline.revert();
      attract?.revert();
      utils.set(wordmark, { opacity: 1 });
    };
  }, []);

  const relief = ui("tilesetRelief");

  // One cell cropped to a data url and repeated. Tiling the whole sheet shows
  // every unrelated tile at once, which reads as noise rather than a surface.
  //
  // The cell is WALL_TILE of tilesetRelief: a plank face, 80 per cent one
  // colour with a vertical grain, and the only candidate on either sheet that
  // repeats without a cap line breaking it into shelving. The previous cell
  // came from tilesetDungeon, which is not a wall sheet at all: it is chests,
  // barrels, gems and pots, and the cell being tiled was a pot. That is the
  // repeating head shape the backdrop used to show.
  const [wall, setWall] = useState<string | null>(null);
  useEffect(() => {
    const tile = relief.tile ?? 16;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = tile;
      canvas.height = tile;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, tile * WALL_TILE.x, tile * WALL_TILE.y, tile, tile, 0, 0, tile, tile);
      setWall(canvas.toDataURL());
    };
    image.src = relief.path;
  }, [relief.path, relief.tile]);

  return (
    <main ref={rootRef} className={styles.title} data-screen="title">
      {/* Static tiled dungeon wall. Fixed position, no parallax, no pointer link. */}
      <div
        className={styles.backdrop}
        style={wall ? { backgroundImage: `url(${wall})`, backgroundSize: `${(relief.tile ?? 16) * 3}px ${(relief.tile ?? 16) * 3}px`, backgroundRepeat: "repeat" } : undefined}
        aria-hidden="true"
      />
      <div className={styles.vignette} aria-hidden="true" />

      <div className={styles.stage}>
        <svg className={styles.frameSvg} viewBox="0 0 400 220" preserveAspectRatio="none" aria-hidden="true">
          <rect ref={frameRef} className={styles.frameStroke} x="2" y="2" width="396" height="216" />
        </svg>

        <h1 ref={wordmarkRef} className={styles.wordmark}>
          SERVPIT
        </h1>
        <p className={styles.tagline} data-anim="title-late">
          Six agents hold their own wallets and decide for themselves whether to enter. You pull the lever.
        </p>
        <p ref={attractRef} className={styles.attract} data-anim="title-late">
          INSERT NOTHING. PULL EVERYTHING.
        </p>
        <div className={styles.actions} data-anim="title-late">
          <Button onClick={onStart}>Enter the pit</Button>
        </div>
      </div>
    </main>
  );
}
