import type { DroidId } from "@observatory/core";
import { DMD_H, DMD_W, type Frame, blank, fillRect, hline, px, rect, vline } from "./frame.js";

export type DmdState = "idle" | "active" | "stale" | "celebrate";

// Deterministic PRNG for stale static (mulberry32) — seeded per time bucket.
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function idleFrame(tMs: number): Frame {
  const f = blank();
  // Sparse breathing lattice: every 4th dot pulses 1..2 on a 1.8s cosine.
  const level = 1 + Math.round((Math.cos((tMs / 1800) * Math.PI * 2) + 1) / 2); // 1..2
  for (let y = 2; y < DMD_H - 2; y += 4) {
    for (let x = 2; x < DMD_W - 2; x += 4) px(f, x, y, level);
  }
  return f;
}

function staleFrame(tMs: number): Frame {
  const f = blank();
  const rand = mulberry32(Math.floor(tMs / 120));
  for (let i = 0; i < 160; i++) {
    px(f, Math.floor(rand() * DMD_W), Math.floor(rand() * DMD_H), rand() < 0.7 ? 1 : 2);
  }
  return f;
}

function celebrateFrame(tMs: number): Frame {
  const f = blank();
  const cx = DMD_W / 2;
  const cy = DMD_H / 2;
  // Two expanding diamond rings, wrapping every 1.6s.
  for (const phase of [0, 800]) {
    const r = Math.floor((((tMs + phase) % 1600) / 1600) * 15);
    for (let i = 0; i <= r; i++) {
      px(f, cx + i, cy - (r - i), 3);
      px(f, cx + i, cy + (r - i), 3);
      px(f, cx - i, cy - (r - i), 3);
      px(f, cx - i, cy + (r - i), 3);
    }
  }
  return f;
}

// Per-droid active glyphs — filled by Task 7. Fallback: idle.
export const activeGlyphs: Partial<Record<DroidId, (tMs: number) => Frame>> = {};

// hk-47 — reviewing: document outline, text stipple, bright scanline sweeping down.
activeGlyphs["hk-47"] = (t) => {
  const f = blank();
  rect(f, 18, 4, 28, 24, 1);
  for (let y = 7; y < 26; y += 3) hline(f, 21, 42, y, 1);
  const scan = 5 + (Math.floor(t / 90) % 22);
  hline(f, 19, 44, scan, 3);
  return f;
};

// 2-1b — diagnosing: ECG trace scrolling right-to-left with a QRS spike.
activeGlyphs["2-1b"] = (t) => {
  const f = blank();
  const offset = Math.floor(t / 50) % DMD_W;
  for (let x = 0; x < DMD_W; x++) {
    const phase = (x + offset) % 32;
    let y = 16;
    if (phase === 12) y = 12;
    else if (phase === 13) y = 4;
    else if (phase === 14) y = 26;
    else if (phase === 15) y = 16;
    px(f, x, y, phase >= 12 && phase <= 15 ? 3 : 2);
  }
  return f;
};

// tt-8l — deciding: gate bars that part and close on a 2s cycle.
activeGlyphs["tt-8l"] = (t) => {
  const f = blank();
  const open = Math.round(((Math.sin((t / 2000) * Math.PI * 2) + 1) / 2) * 10); // 0..10
  fillRect(f, 22 - open, 6, 6, 20, 2);
  fillRect(f, 36 + open, 6, 6, 20, 2);
  vline(f, 32, 4, 27, 1); // threshold line
  return f;
};

// ev-9d9 — operating: radar sweep around a console ring.
activeGlyphs["ev-9d9"] = (t) => {
  const f = blank();
  const cx = 32;
  const cy = 16;
  const R = 13;
  for (let a = 0; a < 64; a++) {
    const th = (a / 64) * Math.PI * 2;
    px(f, Math.round(cx + Math.cos(th) * R), Math.round(cy + Math.sin(th) * R * 0.9), 1);
  }
  const sweep = ((t / 1400) % 1) * Math.PI * 2;
  for (let r = 0; r < R; r++) {
    px(f, Math.round(cx + Math.cos(sweep) * r), Math.round(cy + Math.sin(sweep) * r * 0.9), 3);
  }
  return f;
};

// r5 — dispatching: packet leaving a stacked queue, crossing to the right edge.
activeGlyphs.r5 = (t) => {
  const f = blank();
  for (let i = 0; i < 3; i++) rect(f, 6, 6 + i * 8, 10, 6, 2);
  const x = 18 + (Math.floor(t / 60) % 42);
  fillRect(f, x, 14, 3, 3, 3);
  hline(f, 18, x, 15, 1); // trail
  return f;
};

// copilot — implementing: blocks assembling bottom-up, then resetting.
activeGlyphs.copilot = (t) => {
  const f = blank();
  const total = 24;
  const built = 1 + (Math.floor(t / 180) % (total + 5)); // never fully blank; brief hold at full
  for (let i = 0; i < Math.min(built, total); i++) {
    const col = i % 6;
    const row = Math.floor(i / 6);
    fillRect(f, 14 + col * 6, 26 - row * 6, 5, 5, i === built - 1 ? 3 : 2);
  }
  return f;
};

export function dmdFrame(droid: DroidId, state: DmdState, tMs: number): Frame {
  switch (state) {
    case "idle":
      return idleFrame(tMs);
    case "stale":
      return staleFrame(tMs);
    case "celebrate":
      return celebrateFrame(tMs);
    case "active":
      return (activeGlyphs[droid] ?? idleFrame)(tMs);
  }
}
