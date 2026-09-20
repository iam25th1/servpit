// The one clock. Every renderer system (timeline, effects, juice) is
// advanced from this single requestAnimationFrame loop with the same delta.
// No other file under src/render may schedule time; a test enforces it.

export interface LoopHandle {
  stop(): void;
}

/** Calls step with the elapsed milliseconds since the previous frame, capped so a background tab does not fast forward. */
export function startLoop(step: (deltaMs: number) => void, maxDeltaMs = 100): LoopHandle {
  let last = performance.now();
  let frame = 0;
  let running = true;
  const tick = (now: number): void => {
    if (!running) return;
    const delta = Math.min(maxDeltaMs, Math.max(0, now - last));
    last = now;
    step(delta);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return {
    stop() {
      running = false;
      cancelAnimationFrame(frame);
    },
  };
}
