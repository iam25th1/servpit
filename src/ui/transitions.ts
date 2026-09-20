// The one screen transition system. Every screen change in the flow goes
// through here, so screens never swap instantly.
//
// Out and in are choreographed rather than crossfaded: the outgoing elements
// leave on a stagger, the incoming ones arrive on their own stagger, and the
// two overlap on a single createTimeline. One timeline means the overlap is a
// declared offset rather than two animations racing.
//
// Vestibular safety: every property animated here is element local. opacity,
// scale and a few pixels of translate on individual cards. Nothing translates,
// rotates or blurs a full screen container, and there is no pointer parallax.
//
// This drives DOM chrome only. Reel motion and arena playback stay on the
// phase 2 canvas Timeline, and the two never target the same element.

import { animate, createTimeline, stagger, utils } from "animejs";
import { timing } from "./tokens";

/** Elements a screen offers up for choreography, in the order they should move. */
export function animatable(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-anim]")];
}

const reduced = (): boolean => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface TransitionOptions {
  /** Grid for stagger, when the incoming screen is a card grid. */
  grid?: [number, number];
}

/**
 * Plays the outgoing screen out and the incoming screen in on one timeline.
 * Resolves when the whole choreography is done.
 */
export function playTransition(outgoing: HTMLElement | null, incoming: HTMLElement | null, options: TransitionOptions = {}): Promise<void> {
  const leaving = outgoing ? animatable(outgoing) : [];
  const arriving = incoming ? animatable(incoming) : [];

  if (reduced()) {
    // A cut, not a crossfade. Honest for someone who asked for less motion.
    for (const el of leaving) utils.set(el, { opacity: 0 });
    for (const el of arriving) utils.set(el, { opacity: 1, scale: 1, y: 0 });
    return Promise.resolve();
  }

  // Incoming starts hidden so the two screens do not both read as present.
  for (const el of arriving) utils.set(el, { opacity: 0, scale: 0.94, y: 10 });

  const timeline = createTimeline({ defaults: { ease: "outQuad" } });

  if (leaving.length > 0) {
    timeline.add(leaving, {
      opacity: 0,
      scale: 0.97,
      y: -8,
      duration: timing.move,
      delay: stagger(timing.stagger),
    });
  }

  if (arriving.length > 0) {
    timeline.add(
      arriving,
      {
        opacity: 1,
        scale: 1,
        y: 0,
        duration: timing.screen,
        // grid with from center makes a card wall bloom outward from the
        // middle rather than wipe from one corner.
        delay: options.grid ? stagger(timing.stagger, { grid: options.grid, from: "center" }) : stagger(timing.stagger),
      },
      // Negative offset: the arrival starts before the departure finishes, so
      // the screens hand over rather than queue.
      leaving.length > 0 ? `<-=${Math.abs(timing.overlap)}` : 0,
    );
  }

  return timeline.then(() => undefined);
}

/** Entrance for a list that appears within a screen, such as agent decisions. */
export function staggerIn(elements: HTMLElement[], options: { grid?: [number, number]; delay?: number } = {}): Promise<void> {
  if (elements.length === 0) return Promise.resolve();
  if (reduced()) {
    for (const el of elements) utils.set(el, { opacity: 1, scale: 1, y: 0 });
    return Promise.resolve();
  }
  utils.set(elements, { opacity: 0, scale: 0.96, y: 8 });
  return animate(elements, {
    opacity: 1,
    scale: 1,
    y: 0,
    duration: timing.move,
    ease: "outQuad",
    delay: stagger(timing.stagger, options.grid ? { grid: options.grid, from: "center", start: options.delay ?? 0 } : { start: options.delay ?? 0 }),
  }).then(() => undefined);
}
