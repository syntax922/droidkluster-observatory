import { type Frame, px } from "./frame.js";

export const FONT_W = 3;
export const FONT_H = 5;

// 3x5 glyphs, classic seven-segment-style digits. Each row is a 3-bit mask
// (bit 2 = leftmost column, bit 0 = rightmost). '#' and ' ' round out the
// split-flap charset (space is deliberately all-zero — see glyphRows).
const GLYPHS: Record<string, number[]> = {
  "0": [0b111, 0b101, 0b101, 0b101, 0b111],
  "1": [0b010, 0b110, 0b010, 0b010, 0b111],
  "2": [0b111, 0b001, 0b111, 0b100, 0b111],
  "3": [0b111, 0b001, 0b111, 0b001, 0b111],
  "4": [0b101, 0b101, 0b111, 0b001, 0b001],
  "5": [0b111, 0b100, 0b111, 0b001, 0b111],
  "6": [0b111, 0b100, 0b111, 0b101, 0b111],
  "7": [0b111, 0b001, 0b001, 0b001, 0b001],
  "8": [0b111, 0b101, 0b111, 0b101, 0b111],
  "9": [0b111, 0b101, 0b111, 0b001, 0b111],
  "#": [0b101, 0b111, 0b101, 0b111, 0b101],
  " ": [0, 0, 0, 0, 0],
};

const SPACE: readonly number[] = GLYPHS[" "] as number[];

/** 5 rows of 3-bit masks for `ch`; unknown chars render as space (all zero). */
export function glyphRows(ch: string): number[] {
  const rows = GLYPHS[ch];
  return rows ? [...rows] : [...SPACE];
}

/** Draws `ch`'s glyph at top-left (x, y) with intensity `v`. */
export function drawChar(f: Frame, ch: string, x: number, y: number, v: number): void {
  const rows = glyphRows(ch);
  for (let r = 0; r < FONT_H; r++) {
    const mask = rows[r] ?? 0;
    for (let c = 0; c < FONT_W; c++) {
      const bit = (mask >> (FONT_W - 1 - c)) & 1;
      if (bit) px(f, x + c, y + r, v);
    }
  }
}
