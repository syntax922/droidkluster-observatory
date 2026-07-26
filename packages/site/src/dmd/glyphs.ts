import type { DroidId } from "@observatory/core";
import { DMD_H, DMD_W, type Frame, blank, px } from "./frame.js";

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
    const r = Math.floor((((tMs + phase) % 1600) / 1600) * 22);
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
