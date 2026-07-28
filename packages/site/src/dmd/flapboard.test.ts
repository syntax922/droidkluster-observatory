import { describe, expect, it } from "vitest";
import { BOARD_ROW_Y, FLIP_MS, PAGE_MS, createFlapBoard } from "./flapboard.js";
import { DMD_W, blank } from "./frame.js";

function litRows(f: Uint8Array): Set<number> {
  const rows = new Set<number>();
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < DMD_W; x++) if ((f[y * DMD_W + x] ?? 0) > 0) rows.add(y);
  return rows;
}

describe("flap board", () => {
  it("empty prs draws nothing", () => {
    const b = createFlapBoard();
    b.setPrs([], 0);
    const f = blank();
    b.overlay(f, 1000, false);
    expect(litRows(f).size).toBe(0);
  });
  it("stays inside the bottom band", () => {
    const b = createFlapBoard();
    b.setPrs([1731, 1728], 0);
    const f = blank();
    b.overlay(f, FLIP_MS + 5000, false);
    for (const y of litRows(f)) expect(y >= 25 && y <= 31).toBe(true);
  });
  it("one page renders both entries and sits still after settling", () => {
    const b = createFlapBoard();
    b.setPrs([1731, 1728], 0);
    expect(b.pageCount()).toBe(1);
    expect(b.currentText(10_000)).toContain("#1731 #1728");
    const a = blank();
    const c = blank();
    b.overlay(a, 10_000, false);
    b.overlay(c, 12_345, false);
    expect(Array.from(a)).toEqual(Array.from(c)); // no idle fidgeting
  });
  it("three PRs page on the PAGE_MS cadence", () => {
    const b = createFlapBoard();
    b.setPrs([1731, 1728, 1725], 0);
    expect(b.pageCount()).toBe(2);
    expect(b.currentText(PAGE_MS - 1)).toContain("#1731 #1728");
    expect(b.currentText(PAGE_MS + FLIP_MS + 1000)).toContain("#1725");
  });
  it("a change mid-flight animates: mid-flip frame differs from settled frame", () => {
    const b = createFlapBoard();
    b.setPrs([1731], 0);
    const settled = blank();
    b.overlay(settled, FLIP_MS + 2000, false);
    b.setPrs([1900], FLIP_MS + 2000);
    const mid = blank();
    b.overlay(mid, FLIP_MS + 2000 + 100, false);
    const done = blank();
    b.overlay(done, FLIP_MS + 2000 + FLIP_MS + 2000, false);
    expect(Array.from(mid)).not.toEqual(Array.from(done));
    expect(Array.from(settled)).not.toEqual(Array.from(done));
  });
  it("reduced motion swaps instantly", () => {
    const b = createFlapBoard();
    b.setPrs([1731], 0);
    b.setPrs([1900], 1);
    const f1 = blank();
    const f2 = blank();
    b.overlay(f1, 2, true);
    b.overlay(f2, 5000, true);
    expect(Array.from(f1)).toEqual(Array.from(f2)); // no animation frames under reduced motion
  });
});
