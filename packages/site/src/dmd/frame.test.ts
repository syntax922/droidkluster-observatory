import { describe, expect, it } from "vitest";
import { blank, DMD_W, fillRect, hline, px, rect } from "./frame.js";

describe("frame primitives", () => {
  it("px is bounds-safe and keeps the max intensity", () => {
    const f = blank();
    px(f, -1, 0, 3);
    px(f, 64, 0, 3);
    px(f, 0, 32, 3); // no throw
    px(f, 5, 5, 1);
    px(f, 5, 5, 3);
    px(f, 5, 5, 2);
    expect(f[5 * DMD_W + 5]).toBe(3);
  });
  it("rect draws an outline only", () => {
    const f = blank();
    rect(f, 1, 1, 4, 3, 2);
    expect(f[1 * DMD_W + 1]).toBe(2); // corner
    expect(f[2 * DMD_W + 2]).toBe(0); // interior empty
  });
  it("fillRect fills the interior", () => {
    const f = blank();
    fillRect(f, 1, 1, 3, 3, 1);
    expect(f[2 * DMD_W + 2]).toBe(1);
  });
  it("all frames stay within 0..3", () => {
    const f = blank();
    hline(f, 0, 63, 10, 3);
    expect(Math.max(...f)).toBeLessThanOrEqual(3);
  });
});
