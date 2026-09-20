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
import { useEffect, useRef } from "react";
import { Button } from "@/ui/Button";
import { PlankWall } from "@/ui/PlankWall";
import { timing } from "@/ui/tokens";
import styles from "./title.module.css";

export interface TitleScreenProps {
  onStart: () => void;
}

export function TitleScreen({ onStart }: TitleScreenProps) {
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


  return (
    <main ref={rootRef} className={styles.title} data-screen="title">
      <PlankWall />

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
