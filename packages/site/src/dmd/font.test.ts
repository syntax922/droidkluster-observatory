import { describe, expect, it } from "vitest";
import { drawChar, FONT_H, FONT_W, glyphRows } from "./font.js";
import { blank } from "./frame.js";

describe("font", () => {
  it("every charset glyph is 5 rows of 3-bit masks", () => {
    for (const ch of "0123456789# ") {
      const rows = glyphRows(ch);
      expect(rows).toHaveLength(FONT_H);
      for (const r of rows) expect(r >= 0 && r < 8).toBe(true);
    }
  });
  it("unknown chars render as space (all zero)", () => {
    expect(glyphRows("z")).toEqual([0, 0, 0, 0, 0]);
  });
  it("drawChar sets exactly the mask pixels", () => {
    const f = blank();
    drawChar(f, "1", 0, 0, 2);
    let lit = 0;
    for (const v of f) if (v > 0) lit++;
    const expected = glyphRows("1").reduce(
      (n, m) => n + ((m >> 2) & 1) + ((m >> 1) & 1) + (m & 1),
      0,
    );
    expect(lit).toBe(expected);
    expect(FONT_W).toBe(3);
  });
});
