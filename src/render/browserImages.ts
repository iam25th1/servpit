// Browser ImageLoader: fetches same origin /assets paths (the manifest
// parser only admits those), decodes with createImageBitmap, and builds the
// white silhouette with a source-in fill on an offscreen canvas.

import type { DecodedImage, ImageLoader } from "./assets";

export function createBrowserImageLoader(): ImageLoader {
  return {
    async load(path) {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      return { width: bitmap.width, height: bitmap.height, source: bitmap };
    },
    whiten(image: DecodedImage) {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d canvas context unavailable");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image.source as CanvasImageSource, 0, 0);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return { width: image.width, height: image.height, source: canvas };
    },
  };
}
