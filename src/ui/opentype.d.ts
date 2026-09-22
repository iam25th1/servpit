// The slice of opentype.js the digit guard uses.
//
// The package ships no types of its own, and the guard only ever asks a font
// for a glyph's outline and its advance, so the surface is declared here
// rather than pulled in from elsewhere.

declare module "opentype.js" {
  export type PathCommand =
    | { type: "M" | "L"; x: number; y: number }
    | { type: "Q"; x: number; y: number; x1: number; y1: number }
    | { type: "C"; x: number; y: number; x1: number; y1: number; x2: number; y2: number }
    | { type: "Z" };

  export interface Path {
    commands: PathCommand[];
  }

  export interface Glyph {
    advanceWidth: number;
    getPath(x: number, y: number, fontSize: number): Path;
  }

  export interface Font {
    unitsPerEm: number;
    charToGlyph(character: string): Glyph;
    getPath(text: string, x: number, y: number, fontSize: number): Path;
  }

  export function parse(buffer: ArrayBuffer): Font;
}
