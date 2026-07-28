import { describe, expect, it } from "vitest";
import { CELL_PITCH, createFlapBoard, FLIP_MS, PAGE_MS, STAGGER_MS } from "./flapboard.js";
import { FONT_W } from "./font.js";
import { blank, DMD_W } from "./frame.js";

function litRows(f: Uint8Array): Set<number> {
  const rows = new Set<number>();
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < DMD_W; x++) if ((f[y * DMD_W + x] ?? 0) > 0) rows.add(y);
  return rows;
}

function cellPixels(f: Uint8Array, cellIndex: number): number[] {
  const x0 = 2 + cellIndex * CELL_PITCH;
  const out: number[] = [];
  for (let y = 25; y <= 31; y++) {
    for (let x = x0; x < x0 + FONT_W; x++) out.push(f[y * DMD_W + x] ?? 0);
  }
  return out;
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
  it("cascade settles left-to-right: leftmost cell settles before rightmost", () => {
    const b = createFlapBoard();
    const text = "#1731 #1728"; // 11 chars, all differing from the initial blank board at t=0
    b.setPrs([1731, 1728], 0);
    const lastIndex = text.length - 1; // 10 — the last cell that actually changed
    // Cell 0's window (0..FLIP_MS) has closed; cell `lastIndex`'s window
    // (lastIndex*STAGGER_MS..+FLIP_MS) hasn't opened yet.
    const probeMs = FLIP_MS + 2 * STAGGER_MS;
    const settled = blank();
    b.overlay(settled, 5000, false);
    const probe = blank();
    b.overlay(probe, probeMs, false);
    expect(Array.from(probe)).not.toEqual(Array.from(settled));
    expect(cellPixels(probe, 0)).toEqual(cellPixels(settled, 0));
    expect(cellPixels(probe, lastIndex)).not.toEqual(cellPixels(settled, lastIndex));
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
