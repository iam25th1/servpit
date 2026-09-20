import { describe, expect, it } from "vitest";
import { STAGE_HEIGHT, STAGE_WIDTH, fitStage } from "./stageFit";

describe("fitStage", () => {
  it("uses the largest whole factor that fits both dimensions", () => {
    expect(fitStage(2560, 1440).scale).toBe(2);
    expect(fitStage(3840, 2160).scale).toBe(3);
    expect(fitStage(1280, 720).scale).toBe(1);
    // Width allows two, height only one.
    expect(fitStage(2600, 900).scale).toBe(1);
  });

  it("never returns a fractional scale while a whole one still fits", () => {
    for (const [w, h] of [[1300, 800], [1920, 1080], [2000, 1500], [5000, 3000]]) {
      const fit = fitStage(w, h);
      expect(Number.isInteger(fit.scale), `${w}x${h}`).toBe(true);
      expect(fit.fractional).toBe(false);
    }
  });

  it("falls back to one fractional scale when nothing whole fits, rather than clipping", () => {
    const phone = fitStage(390, 844);
    expect(phone.fractional).toBe(true);
    expect(phone.scale).toBeLessThan(1);
    expect(phone.scale).toBeCloseTo(390 / STAGE_WIDTH, 5);
    // The whole stage stays on screen.
    expect(phone.width).toBeLessThanOrEqual(390);
    expect(phone.height).toBeLessThanOrEqual(844);
  });

  it("fits the stage inside the viewport at every size, so nothing is ever cropped", () => {
    for (const [w, h] of [[320, 568], [390, 844], [768, 1024], [1024, 768], [1280, 720], [1440, 900], [2560, 1440]]) {
      const fit = fitStage(w, h);
      expect(fit.width, `${w}x${h} width`).toBeLessThanOrEqual(w + 0.001);
      expect(fit.height, `${w}x${h} height`).toBeLessThanOrEqual(h + 0.001);
    }
  });

  it("keeps the aspect ratio exactly, so the composition never distorts", () => {
    for (const [w, h] of [[390, 844], [1920, 1080], [900, 1600]]) {
      const fit = fitStage(w, h);
      expect(fit.width / fit.height).toBeCloseTo(STAGE_WIDTH / STAGE_HEIGHT, 5);
    }
  });

  it("never collapses to zero on a degenerate viewport", () => {
    expect(fitStage(0, 0).scale).toBeGreaterThan(0);
    expect(fitStage(Number.NaN, Number.NaN).scale).toBeGreaterThan(0);
  });
});
