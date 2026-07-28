import { drawChar, FONT_H, FONT_W, glyphRows } from "./font.js";
import { type Frame, hline, px } from "./frame.js";

export const BOARD_ROW_Y = 26; // glyph top row (occupies 26..30 of the 25..31 band)
export const CELLS = 15; // 15 cells * 4px pitch + 2px left margin fits 64px
export const CELL_PITCH = 4;
export const PAGE_MS = 4000;
export const FLIP_MS = 300;
export const STAGGER_MS = 60;

const LEFT_MARGIN = 2;
const BAND_TOP = BOARD_ROW_Y - 1; // 25
const BAND_BOTTOM = BOARD_ROW_Y + FONT_H; // 31

export interface FlapBoard {
  setPrs(prs: readonly number[], tMs: number): void; // no-op if unchanged (order-sensitive)
  overlay(f: Frame, tMs: number, reducedMotion: boolean): void;
  pageCount(): number; // for tests
  currentText(tMs: number): string; // settled target text of current page (tests)
}

function blankCells(): string[] {
  return new Array(CELLS).fill(" ") as string[];
}

// Chunk PRs into pages of up to 2 entries each, formatted "#<pr> #<pr>",
// padded/truncated to CELLS chars.
function chunkPages(prs: readonly number[]): string[] {
  const pages: string[] = [];
  for (let i = 0; i < prs.length; i += 2) {
    const text = prs
      .slice(i, i + 2)
      .map((pr) => `#${pr}`)
      .join(" ");
    pages.push(text.length > CELLS ? text.slice(0, CELLS) : text.padEnd(CELLS, " "));
  }
  return pages;
}

function sameOrder(a: readonly number[] | undefined, b: readonly number[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Draws ch's glyph rows that fall within the 25..31 band, skipping the rest —
// this is what lets the flip animation slide glyphs partway off the band
// without ever drawing above row 25 or below row 31.
function drawCharClipped(f: Frame, ch: string, x: number, y: number, v: number): void {
  const rows = glyphRows(ch);
  for (let r = 0; r < FONT_H; r++) {
    const ry = y + r;
    if (ry < BAND_TOP || ry > BAND_BOTTOM) continue;
    const mask = rows[r] ?? 0;
    for (let c = 0; c < FONT_W; c++) {
      const bit = (mask >> (FONT_W - 1 - c)) & 1;
      if (bit) px(f, x + c, ry, v);
    }
  }
}

// Mid-flip: old glyph rises out of the band by `progress`, new glyph rises
// in from below to take its place, plus a v=3 hline across the cell at the
// band's middle row — the flap edge.
function drawFlipCell(f: Frame, oldCh: string, newCh: string, x: number, progress: number): void {
  const shift = Math.min(FONT_H, Math.max(0, Math.floor(progress * FONT_H)));
  drawCharClipped(f, oldCh, x, BOARD_ROW_Y - shift, 2);
  drawCharClipped(f, newCh, x, BOARD_ROW_Y + (FONT_H - shift), 2);
  const midRow = BOARD_ROW_Y + Math.floor(FONT_H / 2);
  hline(f, x, x + FONT_W - 1, midRow, 3);
}

export function createFlapBoard(): FlapBoard {
  let pages: string[] = [];
  let lastPrs: number[] | undefined;
  let lastPageIndex = -1;
  const cellTarget = blankCells();
  const cellPrev = blankCells();
  const cellChangedAt = new Array<number>(CELLS).fill(Number.NEGATIVE_INFINITY);

  function diffPageInto(pageIndex: number, atMs: number): void {
    const text = pages[pageIndex] ?? "";
    for (let i = 0; i < CELLS; i++) {
      const ch = text[i] ?? " ";
      if (ch !== cellTarget[i]) {
        cellPrev[i] = cellTarget[i] ?? " ";
        cellTarget[i] = ch;
        cellChangedAt[i] = atMs;
      }
    }
  }

  return {
    setPrs(prs, tMs) {
      if (sameOrder(lastPrs, prs)) return;
      lastPrs = [...prs];
      pages = chunkPages(prs);
      if (pages.length === 0) {
        for (let i = 0; i < CELLS; i++) {
          cellPrev[i] = cellTarget[i] ?? " ";
          cellTarget[i] = " ";
          cellChangedAt[i] = tMs;
        }
        lastPageIndex = -1;
        return;
      }
      const rawSlot = Math.floor(tMs / PAGE_MS);
      const pageIndex = rawSlot % pages.length;
      diffPageInto(pageIndex, tMs);
      lastPageIndex = pageIndex;
    },

    overlay(f, tMs, reducedMotion) {
      if (pages.length === 0) return;
      const rawSlot = Math.floor(tMs / PAGE_MS);
      const pageIndex = rawSlot % pages.length;
      if (lastPageIndex !== -1 && pageIndex !== lastPageIndex) {
        diffPageInto(pageIndex, rawSlot * PAGE_MS);
      }
      lastPageIndex = pageIndex;

      // Cascade: cell i's flip window opens at changedAt + i*STAGGER_MS and
      // runs FLIP_MS — left cells start (and settle) first, right cells wait
      // their turn, matching a real Solari board's left-to-right sweep.
      for (let i = 0; i < CELLS; i++) {
        const x = LEFT_MARGIN + i * CELL_PITCH;
        const target = cellTarget[i] ?? " ";
        const prev = cellPrev[i] ?? " ";
        const changedAt = cellChangedAt[i] ?? Number.NEGATIVE_INFINITY;
        const start = changedAt + i * STAGGER_MS;
        const end = start + FLIP_MS;
        if (!reducedMotion && tMs >= start && tMs < end) {
          drawFlipCell(f, prev, target, x, (tMs - start) / FLIP_MS);
        } else {
          const shown = !reducedMotion && tMs < start ? prev : target;
          // All settled cells render uniform (v=2) — the leading "#" used to
          // get a v=3 accent, but that read as 12 persistent full-brightness
          // pixels rather than a momentary highlight, out of place on an
          // otherwise-settled page.
          drawChar(f, shown, x, BOARD_ROW_Y, 2);
        }
      }
    },

    pageCount() {
      return pages.length;
    },

    currentText(tMs) {
      if (pages.length === 0) return " ".repeat(CELLS);
      const idx = Math.floor(tMs / PAGE_MS) % pages.length;
      return pages[idx] ?? " ".repeat(CELLS);
    },
  };
}
