// Drawing primitives. The renderer talks to a DrawTarget so its logic can be
// tested against a recording fake; CanvasDrawTarget is the browser
// implementation. Camera is fixed: the only transform ever applied is one
// integer scale from logical pixels to device pixels.

import type { DecodedImage, Slice } from "./assets";

export interface DrawOptions {
  /** Sprite local scale about the sprite centre. Never a canvas scale. */
  scale?: number;
  alpha?: number;
  /** Draw the white silhouette instead of the sprite. */
  white?: boolean;
}

export interface DrawTarget {
  readonly width: number;
  readonly height: number;
  clear(color: string): void;
  fillRect(x: number, y: number, w: number, h: number, color: string, alpha?: number): void;
  drawSlice(slice: Slice, x: number, y: number, options?: DrawOptions): void;
}

/** Largest whole factor that fits the logical size inside the container, never below 1. */
export function computeIntegerScale(containerWidth: number, containerHeight: number, logicalWidth: number, logicalHeight: number): number {
  const factor = Math.floor(Math.min(containerWidth / logicalWidth, containerHeight / logicalHeight));
  return Number.isFinite(factor) && factor >= 1 ? factor : 1;
}

export class CanvasDrawTarget implements DrawTarget {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly width: number,
    readonly height: number,
    private readonly whiteOf: (image: DecodedImage) => DecodedImage,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    this.ctx = ctx;
    this.setScale(1);
  }

  /** Resizes the backing store to logical size times an integer factor. */
  setScale(scale: number): void {
    if (!Number.isInteger(scale) || scale < 1) throw new RangeError(`scale must be a positive integer, got ${scale}`);
    this.scale = scale;
    this.canvas.width = this.width * scale;
    this.canvas.height = this.height * scale;
    this.canvas.style.width = `${this.width * scale}px`;
    this.canvas.style.height = `${this.height * scale}px`;
    this.beginFrame();
  }

  /** Call once per frame: a canvas resize resets smoothing and the transform. */
  beginFrame(): void {
    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.globalAlpha = 1;
  }

  clear(color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  fillRect(x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
    this.ctx.globalAlpha = 1;
  }

  drawSlice(slice: Slice, x: number, y: number, options: DrawOptions = {}): void {
    const image = options.white ? this.whiteOf(slice.image) : slice.image;
    const s = options.scale ?? 1;
    const dw = slice.sw * s;
    const dh = slice.sh * s;
    const dx = x - (dw - slice.sw) / 2;
    const dy = y - (dh - slice.sh) / 2;
    this.ctx.globalAlpha = options.alpha ?? 1;
    this.ctx.drawImage(image.source as CanvasImageSource, slice.sx, slice.sy, slice.sw, slice.sh, dx, dy, dw, dh);
    this.ctx.globalAlpha = 1;
  }
}
