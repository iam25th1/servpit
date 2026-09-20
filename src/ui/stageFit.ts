// The game renders into a fixed logical stage rather than into document flow.
//
// Every screen composes inside 1280x720 and never reads viewport height, so a
// screen cannot be tall on one display and short on another. The stage is
// centred and scaled to fit, letterboxed with the page background.
//
// Scale is the largest whole factor that fits, because the art is pixel art
// and a fractional factor resamples it. Below one whole factor there is no
// integer left to pick, so a single fractional scale is allowed rather than
// clipping the stage or shrinking it below usable size; that path is phones
// and small windows, where slightly soft art beats a cropped screen.

export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 720;

export interface StageFit {
  scale: number;
  /** True when the scale had to go fractional to fit at all. */
  fractional: boolean;
  width: number;
  height: number;
}

export function fitStage(viewportWidth: number, viewportHeight: number, stageWidth = STAGE_WIDTH, stageHeight = STAGE_HEIGHT): StageFit {
  const w = Number.isFinite(viewportWidth) ? viewportWidth : stageWidth;
  const h = Number.isFinite(viewportHeight) ? viewportHeight : stageHeight;
  const raw = Math.min(w / stageWidth, h / stageHeight);

  if (raw >= 1) {
    const scale = Math.floor(raw);
    return { scale, fractional: false, width: stageWidth * scale, height: stageHeight * scale };
  }
  // Nothing whole fits. Use the real ratio so the whole stage stays on screen.
  const scale = Math.max(0.2, raw);
  return { scale, fractional: true, width: stageWidth * scale, height: stageHeight * scale };
}
