"use client";

// The dungeon's plank wall, tiled.
//
// One cell of tilesetRelief cropped to a data url and repeated. Tiling the
// whole sheet shows every unrelated tile at once, which reads as noise rather
// than a surface.
//
// The cell is a plank face, 80 per cent #5f7160 with a vertical grain, and
// the only candidate on either sheet that repeats without a cap line breaking
// it into shelving. What used to be here came from tilesetDungeon, which is
// not a wall sheet at all: it is chests, barrels, gems and pots, and the cell
// being tiled was a pot.
//
// A static field. It never moves, never parallaxes and never responds to the
// pointer.

import { useEffect, useState } from "react";
import { useUiKit } from "./UiKit";
import styles from "./plankWall.module.css";

/** The cell of tilesetRelief this repeats. */
export const WALL_TILE = { x: 5, y: 1 } as const;
/** The lightest pixel in that cell, which the contrast test composites from. */
export const WALL_LIGHTEST = "#5f7160";
/** Whole pixel scale for the repeat. */
const WALL_SCALE = 3;

export function PlankWall() {
  const relief = useUiKit().ui("tilesetRelief");
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

  const size = (relief.tile ?? 16) * WALL_SCALE;
  return (
    <>
      <div
        className={styles.wall}
        style={wall ? { backgroundImage: `url(${wall})`, backgroundSize: `${size}px ${size}px`, backgroundRepeat: "repeat" } : undefined}
        aria-hidden="true"
      />
      <div className={styles.vignette} aria-hidden="true" />
    </>
  );
}
