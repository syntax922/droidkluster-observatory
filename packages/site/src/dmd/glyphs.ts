import type { DroidId } from "@observatory/core";
import { DMD_H, DMD_W, type Frame, blank, fillRect, hline, px, rect, vline } from "./frame.js";

export type DmdState = "idle" | "active" | "stale" | "celebrate" | "cooling" | "domain";

// primary = purview.prs.length (the flap-board's page count); secondary is
// per-droid load (see purview.ts DroidPurview.secondary) — r5: in-flight
// dispatches; hk-47: reviews posted in window; others 0.
export interface GlyphCounts {
  primary: number;
  secondary: number;
}

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

// Kept exported: fallback for unexpected droid ids (not in the DroidId union
// at runtime — e.g. a schema drift) and as the shared reference the standby
// signatures below intentionally depart from. Not otherwise used for a known
// droid's idle render anymore — see standbyGlyphs.
export function idleFrame(tMs: number): Frame {
  const f = blank();
  // Sparse breathing lattice: every 4th dot pulses 1..2 on a 1.8s cosine.
  const level = 1 + Math.round((Math.cos((tMs / 1800) * Math.PI * 2) + 1) / 2); // 1..2
  for (let y = 2; y < DMD_H - 2; y += 4) {
    for (let x = 2; x < DMD_W - 2; x += 4) px(f, x, y, level);
  }
  return f;
}

// Slow 1..2 cosine breath over `periodMs`, peaking (2) at t=0.
function breath(tMs: number, periodMs: number): 1 | 2 {
  return (1 + Math.round((Math.cos((tMs / periodMs) * Math.PI * 2) + 1) / 2)) as 1 | 2;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
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

// Per-droid active glyphs — filled by Task 7. Fallback: idle. The `counts`
// param is optional per-entry (functions with fewer declared params remain
// assignable here); only scenes whose brightness/count is load-scaled — e.g.
// hk-47's desk, r5's weld line — declare it.
export const activeGlyphs: Partial<Record<DroidId, (tMs: number, counts: GlyphCounts) => Frame>> =
  {};

// Per-droid domain glyphs — filled by Tasks 4-5 (2-1b ECG + tt-8l shipping,
// hk-47 desk + r5 weld line). A droid with no entry here falls back to the
// cooling lift (see dmdFrame's "domain" case) rather than a fabricated
// animation — no glyph is better than an invented one.
export const domainGlyphs: Partial<Record<DroidId, (tMs: number, counts: GlyphCounts) => Frame>> =
  {};

// Wrap a coordinate into [0, DMD_W) — domain scenes scroll continuously and
// need beat/box positions to re-enter from the opposite edge rather than
// clip at the boundary.
function wrapX(x: number): number {
  return ((x % DMD_W) + DMD_W) % DMD_W;
}

// hk-47 — reviewer's desk. Shared geometry across active/domain/idle: a desk
// (hline + two legs) with the droid's head+shoulders sitting behind it, an
// inbox tray to the left and an outbox tray to the right. Coordinates are
// fixed furniture; only fill levels and the animated sheet vary by state.
const HK_DESK_X0 = 20;
const HK_DESK_X1 = 44;
const HK_DESK_Y = 18;
const HK_INBOX_X0 = 4;
const HK_INBOX_X1 = 14;
const HK_OUTBOX_X0 = 50;
const HK_OUTBOX_X1 = 60;
const HK_TRAY_Y = 17;

function drawHkFurniture(f: Frame, deskV: number, headShoulderV: number): void {
  hline(f, HK_DESK_X0, HK_DESK_X1, HK_DESK_Y, deskV);
  vline(f, 22, 19, 22, 1);
  vline(f, 42, 19, 22, 1);
  fillRect(f, 30, 8, 5, 4, headShoulderV); // head
  fillRect(f, 28, 12, 9, 5, headShoulderV); // shoulders
}

// A tray of `count` items (clamped 0-6) stacked upward from the tray-bottom
// row; an empty tray still shows a dim tray-bottom line so the furniture
// reads even with nothing in it.
function drawHkTray(f: Frame, x0: number, x1: number, count: number, itemV: number): void {
  const n = clamp(count, 0, 6);
  if (n === 0) {
    hline(f, x0, x1, HK_TRAY_Y, 1);
    return;
  }
  for (let i = 0; i < n; i++) hline(f, x0, x1, HK_TRAY_Y - i, itemV);
}

// The single sheet that carries through the review cycle: inbox -> desk
// (read, flickering) -> outbox, on a 2200ms loop.
function drawHkSheet(f: Frame, t: number): void {
  const cycle = 2200;
  const p = (t % cycle) / cycle;
  const inboxX = 6;
  const deskX = 30;
  const outboxX = 54;
  const y = 14;
  let x: number;
  if (p < 0.3) {
    x = Math.round(inboxX + (p / 0.3) * (deskX - inboxX));
  } else if (p < 0.7) {
    x = deskX;
  } else {
    x = Math.round(deskX + ((p - 0.7) / 0.3) * (outboxX - deskX));
  }
  rect(f, x, y, 4, 3, 2);
  if (p >= 0.3 && p < 0.7) {
    // Read flicker: a single v=3 px toggling on/off per 150ms bucket.
    if (Math.floor(t / 150) % 2 === 0) px(f, x + 1, y + 1, 3);
  }
}

activeGlyphs["hk-47"] = (t, counts) => {
  const f = blank();
  drawHkFurniture(f, 2, 2);
  drawHkTray(f, HK_INBOX_X0, HK_INBOX_X1, counts.primary, 2);
  drawHkTray(f, HK_OUTBOX_X0, HK_OUTBOX_X1, counts.secondary, 2);
  drawHkSheet(f, t);
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

// Shared rocket silhouette for tt-8l's active (loading) and celebrate
// (blast-off) scenes — a triangular nose atop a 6-wide body with two fins,
// nominally sitting with its body top at y=8 (riseY=0). `riseY` shifts the
// whole rocket upward (used by blast-off's launch climb); the body's own
// height (14) keeps the fins/nose offsets correct at any riseY.
function drawRocketAt(f: Frame, riseY: number, v: number): void {
  const bodyTop = 8 - riseY;
  px(f, 50, bodyTop - 3, v);
  px(f, 51, bodyTop - 3, v);
  hline(f, 49, 52, bodyTop - 2, v);
  hline(f, 48, 53, bodyTop - 1, v);
  fillRect(f, 48, bodyTop, 6, 14, v);
  px(f, 47, bodyTop + 14, v);
  px(f, 46, bodyTop + 13, v);
  px(f, 46, bodyTop + 12, v);
  px(f, 54, bodyTop + 14, v);
  px(f, 55, bodyTop + 13, v);
  px(f, 55, bodyTop + 12, v);
}

// tt-8l — deciding: rocket loading. Crates march along the belt toward a
// hatch beside the rocket and vanish (absorbed) rather than crossing it; the
// hatch seam flickers to read as "receiving" traffic.
activeGlyphs["tt-8l"] = (t) => {
  const f = blank();
  hline(f, 40, 60, 22, 1);
  drawRocketAt(f, 0, 2);
  const speed = 60;
  for (let i = 0; i < 4; i++) {
    const bx = (Math.floor(t / speed) + i * 12) % 52;
    if (bx <= 38) rect(f, bx, 16, 8, 6, 2);
  }
  if (Math.floor(t / 400) % 2 === 0) vline(f, 46, 14, 20, 3);
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

// r5 — weld line. Shared geometry across active/domain/idle: a belt with a
// weld-station arch; chassis units ride the belt left-to-right and spark
// while passing under the arch.
const R5_BELT_Y = 20;
const R5_ARCH_X = 28;
const R5_ARCH_Y = 10;
const R5_ARCH_W = 8;
const R5_ARCH_H = 10;
const R5_CHASSIS_W = 10;
const R5_CHASSIS_H = 5;
const R5_CHASSIS_TOP = 15; // bottom row (19) sits just above the belt (20)
const R5_TRAVEL_LO = -14; // fully offscreen left
const R5_TRAVEL_HI = 78; // fully offscreen right
const R5_CYCLE = 3000;
const R5_ARCH_TRIGGER_LO = 26;
const R5_ARCH_TRIGGER_HI = 38;

function drawR5Belt(f: Frame, beltV: number, archV: number): void {
  hline(f, 0, DMD_W - 1, R5_BELT_Y, beltV);
  rect(f, R5_ARCH_X, R5_ARCH_Y, R5_ARCH_W, R5_ARCH_H, archV);
}

function r5ChassisX(p: number): number {
  return Math.round(R5_TRAVEL_LO + p * (R5_TRAVEL_HI - R5_TRAVEL_LO));
}

// Active sparks: 5-8 px, all v=3 (active isn't domain-capped).
function drawR5SparksActive(f: Frame, chassisX: number, t: number): void {
  const rand = mulberry32(Math.floor(t / 70));
  const n = 5 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const dx = Math.floor(rand() * 6);
    const dy = Math.floor(rand() * 6);
    px(f, chassisX + dx, R5_CHASSIS_TOP - 6 + dy, 3);
  }
}

// Domain sparks: 2-3 px, bulk v=2, at most 2 of them lifted to a v=3 tip —
// structurally, at most one chassis is ever under the arch at once (see the
// count<=4 non-overlap argument in the task report), so this per-call cap of
// 2 is also the whole frame's v=3 budget.
function drawR5SparksDomain(f: Frame, chassisX: number, t: number): void {
  const rand = mulberry32(Math.floor(t / 70));
  const n = 2 + Math.floor(rand() * 2);
  const tipCount = Math.min(2, n - 1);
  for (let i = 0; i < n; i++) {
    const dx = Math.floor(rand() * 6);
    const dy = Math.floor(rand() * 6);
    px(f, chassisX + dx, R5_CHASSIS_TOP - 6 + dy, i < tipCount ? 3 : 2);
  }
}

activeGlyphs.r5 = (t, counts) => {
  const f = blank();
  drawR5Belt(f, 1, 1);
  const count = clamp(counts.secondary, 1, 4);
  for (let j = 0; j < count; j++) {
    const offset = (j * R5_CYCLE) / count;
    const p = ((t + offset) % R5_CYCLE) / R5_CYCLE;
    const x = r5ChassisX(p);
    rect(f, x, R5_CHASSIS_TOP, R5_CHASSIS_W, R5_CHASSIS_H, 2);
    if (x >= R5_ARCH_TRIGGER_LO && x < R5_ARCH_TRIGGER_HI) drawR5SparksActive(f, x, t);
  }
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

// 2-1b — domain: load-scaled ECG. One QRS complex per active CI job
// (clamped 1-6), evenly spaced and scrolling with the trace, baselined a
// row above the active glyph's so the two read as distinct instruments.
// Each beat's spike tip is exactly 2px at full intensity — the bulk of the
// waveform stays at 2, keeping domain scenes readably dimmer than active.
domainGlyphs["2-1b"] = (t, counts) => {
  const f = blank();
  hline(f, 0, DMD_W - 1, 12, 1);
  const beats = Math.max(1, Math.min(6, counts.primary));
  const scroll = Math.floor(t / 80) % DMD_W;
  for (let i = 0; i < beats; i++) {
    const cx = Math.floor(((i + 0.5) * DMD_W) / beats) + scroll;
    px(f, wrapX(cx - 2), 8, 2);
    px(f, wrapX(cx - 1), 4, 2);
    px(f, wrapX(cx), 4, 3);
    px(f, wrapX(cx + 1), 4, 3);
    px(f, wrapX(cx + 2), 20, 2);
    px(f, wrapX(cx + 3), 12, 2);
  }
  return f;
};

// tt-8l shipping-department box states, driven by phase p in [0, 1) of the
// per-box cycle. Body is a fixed 12x8 outline at y=14; only its x position
// and the top-edge treatment (open flaps / closing flaps / tape pass /
// sealed) change across the phase.
function drawShippingBox(f: Frame, p: number): void {
  const boxTop = 14;
  const boxW = 12;
  let x: number;
  if (p < 0.35) {
    x = Math.round(-14 + (p / 0.35) * 40); // slide in: -14 -> 26
  } else if (p < 0.7) {
    x = 26; // parked under the tape gun
  } else {
    x = Math.round(26 + ((p - 0.7) / 0.3) * 40); // slide out: 26 -> 66
  }
  rect(f, x, boxTop, boxW, 8, 2);

  if (p < 0.35) {
    for (let i = 1; i <= 3; i++) {
      px(f, x - i, boxTop - i, 2);
      px(f, x + boxW - 1 + i, boxTop - i, 2);
    }
  } else if (p < 0.5) {
    const len = Math.max(0, Math.round(3 * (1 - (p - 0.35) / 0.15)));
    if (len === 0) {
      hline(f, x, x + boxW - 1, boxTop, 2);
    } else {
      for (let i = 1; i <= len; i++) {
        px(f, x - i, boxTop - i, 2);
        px(f, x + boxW - 1 + i, boxTop - i, 2);
      }
    }
  } else if (p < 0.7) {
    // Tape pass: the sealed trail behind the gun stays bulk v=2 (the global
    // domain rule caps v=3 to small accents, not a growing hline) — only the
    // gun's leading edge gets a <=2px v=3 accent riding at its head.
    const tapeX = x + Math.round(((p - 0.5) / 0.2) * (boxW - 1));
    hline(f, x, tapeX, boxTop, 2);
    px(f, tapeX, boxTop, 3);
    if (tapeX - 1 >= x) px(f, tapeX - 1, boxTop, 3);
    fillRect(f, Math.max(x, tapeX - 1), boxTop - 2, 3, 2, 2);
  } else {
    // Sealed and static — the tape line is fully laid, no accent left to draw.
    hline(f, x, x + boxW - 1, boxTop, 2);
  }
}

// tt-8l — domain: the taping line. One box per open PR in the merge queue
// (clamped 1-3), staggered evenly around the cycle so they read as a
// continuous line rather than lockstep duplicates.
domainGlyphs["tt-8l"] = (t, counts) => {
  const f = blank();
  hline(f, 0, DMD_W - 1, 22, 1);
  const boxes = Math.max(1, Math.min(3, counts.primary));
  const cycle = 2600;
  for (let j = 0; j < boxes; j++) {
    const boxOffset = (j * cycle) / boxes;
    const p = ((t + boxOffset) % cycle) / cycle;
    drawShippingBox(f, p);
  }
  return f;
};

// tt-8l — celebrate override: blast-off, not the shared diamond rings. The
// rocket climbs off the top of the board over a 3s window (naturally
// clipped by px()'s bounds check) while jittered exhaust columns trail
// beneath it; the pad stays lit throughout.
function blastOffFrame(tMs: number): Frame {
  const f = blank();
  hline(f, 40, 60, 22, 1);
  const progress = (tMs % 3000) / 3000;
  const riseY = Math.round(progress * 22); // body top climbs y=8 -> y=-14
  drawRocketAt(f, riseY, 2);
  const bodyBottom = 8 - riseY + 14;
  const rand = mulberry32(Math.floor(tMs / 90));
  const cols = 2 + Math.round(progress); // widens 2 -> 3 as it climbs
  for (let i = 0; i < cols; i++) {
    const cx = 50 + i - Math.floor(cols / 2) + (Math.floor(rand() * 3) - 1);
    const len = 2 + Math.floor(rand() * 3);
    vline(f, cx, bodyBottom, Math.min(23, bodyBottom + len), 3);
  }
  return f;
}

// hk-47 — domain: the same desk, dimmed and frozen. No sheet, no flicker —
// domain instruments are quiet-monitoring, not a live animation — so this
// glyph is intentionally pure-function-of-counts with tMs unused. Inbox and
// outbox still scale with purview counts (same clamp(0,6) as active) so
// review backlog reads at a glance; head/shoulders drop to v=1.
domainGlyphs["hk-47"] = (_t, counts) => {
  const f = blank();
  drawHkFurniture(f, 2, 1);
  drawHkTray(f, HK_INBOX_X0, HK_INBOX_X1, counts.primary, 2);
  drawHkTray(f, HK_OUTBOX_X0, HK_OUTBOX_X1, counts.secondary, 2);
  return f;
};

// r5 — domain: same belt+arch+chassis scene as active, but v-capped and with
// sparser sparks (drawR5SparksDomain: bulk v=2, <=2px v=3 tip). Chassis count
// scales 1-4 with in-flight dispatches.
domainGlyphs.r5 = (t, counts) => {
  const f = blank();
  drawR5Belt(f, 1, 1);
  const count = clamp(counts.secondary, 1, 4);
  for (let j = 0; j < count; j++) {
    const offset = (j * R5_CYCLE) / count;
    const p = ((t + offset) % R5_CYCLE) / R5_CYCLE;
    const x = r5ChassisX(p);
    rect(f, x, R5_CHASSIS_TOP, R5_CHASSIS_W, R5_CHASSIS_H, 2);
    if (x >= R5_ARCH_TRIGGER_LO && x < R5_ARCH_TRIGGER_HI) drawR5SparksDomain(f, x, t);
  }
  return f;
};

// Per-droid STANDBY signature glyphs — a dim, slow, recognizable quiet
// variant of each droid's active glyph. This is what an idle station renders
// (instead of the shared anonymous breathing lattice above), so a fleet of
// idle stations reads as six distinct machines at rest rather than one
// active station surrounded by identical placeholders. Max intensity 2,
// periods in the 4-6s range — deliberately calmer than any active glyph.
export const standbyGlyphs: Record<DroidId, (tMs: number) => Frame> = {
  // hk-47 — the desk at rest: furniture + droid at v=1, both trays empty
  // (tray-bottom lines only). The inbox tray-bottom is the one breathing
  // element (1..2 on 5s) — the only sign anything might arrive.
  "hk-47": (t) => {
    const f = blank();
    drawHkFurniture(f, 1, 1);
    hline(f, HK_INBOX_X0, HK_INBOX_X1, HK_TRAY_Y, breath(t, 5000));
    hline(f, HK_OUTBOX_X0, HK_OUTBOX_X1, HK_TRAY_Y, 1);
    return f;
  },

  // 2-1b — flat baseline (no QRS spike) with a single small blip crossing
  // once per 5s, instead of the active trace's continuous scroll+spike.
  "2-1b": (t) => {
    const f = blank();
    hline(f, 0, DMD_W - 1, 16, 1);
    const period = 5000;
    const x = Math.floor(((t % period) / period) * DMD_W);
    fillRect(f, x, 15, 3, 3, 2);
    return f;
  },

  // tt-8l — the belt at rest: no boxes moving, just an empty flat-packed
  // box outline breathing 1..2 on 5s.
  "tt-8l": (t) => {
    const f = blank();
    hline(f, 0, DMD_W - 1, 22, 1);
    rect(f, 26, 16, 12, 6, breath(t, 5000));
    return f;
  },

  // ev-9d9 — console ring at rest intensity, sweep still rotating but at
  // 1/4 the active angular speed and dimmed from 3 to 2.
  "ev-9d9": (t) => {
    const f = blank();
    const cx = 32;
    const cy = 16;
    const R = 13;
    for (let a = 0; a < 64; a++) {
      const th = (a / 64) * Math.PI * 2;
      px(f, Math.round(cx + Math.cos(th) * R), Math.round(cy + Math.sin(th) * R * 0.9), 1);
    }
    const sweep = ((t / (1400 * 4)) % 1) * Math.PI * 2;
    for (let r = 0; r < R; r++) {
      px(f, Math.round(cx + Math.cos(sweep) * r), Math.round(cy + Math.sin(sweep) * r * 0.9), 2);
    }
    return f;
  },

  // r5 — the belt stopped, one chassis parked under the arch. The chassis
  // outline breathes 1..2 on 5s as the only sign of readiness.
  r5: (t) => {
    const f = blank();
    drawR5Belt(f, 1, 1);
    rect(f, 27, R5_CHASSIS_TOP, R5_CHASSIS_W, R5_CHASSIS_H, breath(t, 5000));
    return f;
  },

  // copilot — the full 24-block grid is already assembled, just dark (1)
  // instead of mid-build. One corner block pulses 1..2 on 6s.
  copilot: (t) => {
    const f = blank();
    const total = 24;
    for (let i = 0; i < total; i++) {
      const col = i % 6;
      const row = Math.floor(i / 6);
      fillRect(f, 14 + col * 6, 26 - row * 6, 5, 5, 1);
    }
    fillRect(f, 14 + 5 * 6, 26 - 3 * 6, 5, 5, breath(t, 6000));
    return f;
  },
};

// COOLING renders the droid's standby signature with a brightness lift —
// every nonzero pixel intensity bumped by 1 (capped at 3) — so a recently
// active station visibly reads warmer than a station that's been quiet, and
// still visibly less than the full-brightness active render. This is what
// makes recent activity honest rather than another animation guess: the
// lift is driven by a recorded `last_action_at` timestamp (see controller.ts
// deriveDmdState), not a decorative always-on pulse.
function coolingFrame(droid: DroidId, tMs: number): Frame {
  const base = (standbyGlyphs[droid] ?? idleFrame)(tMs);
  const f = blank();
  for (let i = 0; i < base.length; i++) {
    const v = base[i] ?? 0;
    f[i] = v > 0 ? Math.min(3, v + 1) : 0;
  }
  return f;
}

export function dmdFrame(
  droid: DroidId,
  state: DmdState,
  tMs: number,
  counts?: GlyphCounts,
): Frame {
  switch (state) {
    case "idle":
      return (standbyGlyphs[droid] ?? idleFrame)(tMs);
    case "cooling":
      return coolingFrame(droid, tMs);
    case "stale":
      return staleFrame(tMs);
    case "celebrate":
      return droid === "tt-8l" ? blastOffFrame(tMs) : celebrateFrame(tMs);
    case "active": {
      const glyph = activeGlyphs[droid];
      return glyph ? glyph(tMs, counts ?? { primary: 0, secondary: 0 }) : idleFrame(tMs);
    }
    case "domain": {
      const glyph = domainGlyphs[droid];
      return glyph ? glyph(tMs, counts ?? { primary: 0, secondary: 0 }) : coolingFrame(droid, tMs);
    }
  }
}
