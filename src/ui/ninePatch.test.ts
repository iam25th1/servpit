import { describe, expect, it } from "vitest";
import manifestJson from "../../public/assets/manifest.json";
import { parseManifest, type UiDef } from "@/render/manifest";
import { minimumSize, ninePatchStyle } from "./ninePatch";

const manifest = parseManifest(manifestJson);
const find = (id: string): UiDef => manifest.ui.find((u) => u.id === id)!;

describe("ninePatchStyle", () => {
  it("slices at the measured inset and scales the border by a whole factor", () => {
    const panel = find("panel");
    const style = ninePatchStyle(panel, 3);
    expect(panel.slice).toEqual({ x: 6, y: 6 });
    expect(style.borderImageSlice).toBe("6 6 fill");
    expect(style.borderWidth).toBe("18px 18px");
    expect(style.borderImageWidth).toBe("18px 18px");
  });

  it("uses round rather than stretch, so the pixels stay square", () => {
    expect(ninePatchStyle(find("panel"), 2).borderImageRepeat).toBe("round");
    expect(ninePatchStyle(find("panel"), 2).imageRendering).toBe("pixelated");
  });

  it("keeps a rectangular sprite's two insets apart rather than averaging them", () => {
    const button = find("button");
    expect(button.slice).toEqual({ x: 6, y: 3 });
    const style = ninePatchStyle(button, 3);
    // vertical then horizontal, as CSS expects.
    expect(style.borderWidth).toBe("9px 18px");
    expect(style.borderImageSlice).toBe("3 6 fill");
  });

  it("points at the manifest path, never a hardcoded one", () => {
    expect(ninePatchStyle(find("focus"), 1).borderImageSource).toBe(`url(${find("focus").path})`);
  });

  it("refuses a fractional or zero scale, which would blur the art", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => ninePatchStyle(find("panel"), bad)).toThrow(RangeError);
    }
  });

  it("refuses a sprite that is not a nine patch", () => {
    expect(() => ninePatchStyle(find("dialogBox"), 2)).toThrow(/no nine patch slice/);
  });

  it("works for every nine patch in the manifest", () => {
    for (const def of manifest.ui.filter((u) => u.kind === "ninePatch")) {
      const style = ninePatchStyle(def, 3);
      expect(style.borderImageSource, def.id).toContain(def.path);
      expect(style.borderImageSlice, def.id).toMatch(/^\d+ \d+ fill$/);
    }
  });
});

describe("minimumSize", () => {
  it("is the two corners at scale, so a panel never crushes its own frame", () => {
    expect(minimumSize(find("panel"), 3)).toEqual({ width: 36, height: 36 });
    expect(minimumSize(find("button"), 3)).toEqual({ width: 36, height: 18 });
    expect(minimumSize(find("focus"), 1)).toEqual({ width: 6, height: 6 });
  });
});
