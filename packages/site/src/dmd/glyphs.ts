import type { DroidId } from "@observatory/core";
import { blank, DMD_H, DMD_W, type Frame, fillRect, hline, px, rect, vline } from "./frame.js";

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

// Continuous ambient motion for calm (standby) glyphs: a triangle wave over
// `periodMs` quantized to `steps` (0..steps-1) integer levels, rising then
// falling. Unlike `breath` (a binary 1..2 toggle), this is the "old idiom"
// restored — many intermediate spatial states per cycle, e.g. a tray filling
// then clearing item-by-item — so a standby glyph reads as continuously
// alive rather than a single element flipping between two frames.
function breathSteps(tMs: number, periodMs: number, steps: number): number {
  const half = periodMs / 2;
  const phase = tMs % periodMs;
  const rising = phase <= half ? phase / half : (periodMs - phase) / half;
  return Math.round(rising * (steps - 1));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Shared "idling conveyor" ambient element for tt-8l and r5's standby
// glyphs: sparse v=2 accent dots, one every 6px, drifting 1px/sec along `y`
// on top of the belt's own static v=1 line (px() takes the max, so this only
// brightens specific cells — it never erases the belt). Skips any x in
// [skipLo, skipHi) so a fixture (e.g. r5's weld arch) reads as something the
// belt runs under, not through. Changes exactly once per second — the same
// ~1 visible-change/sec cadence the pre-purview idle glyphs had.
function drawDriftingAccent(
  f: Frame,
  y: number,
  tMs: number,
  skipLo?: number,
  skipHi?: number,
): void {
  const offset = Math.floor(tMs / 1000) % 6;
  for (let x = offset; x < DMD_W; x += 6) {
    if (skipLo !== undefined && skipHi !== undefined && x >= skipLo && x < skipHi) continue;
    px(f, x, y, 2);
  }
}

function staleFrame(tMs: number): Frame {
  const f = blank();
  const rand = mulberry32(Math.floor(tMs / 120));
  for (let i = 0; i < 160; i++) {
    px(f, Math.floor(rand() * DMD_W), Math.floor(rand() * DMD_H), rand() < 0.7 ? 1 : 2);
  }
  return f;
}

export function celebrateFrame(tMs: number): Frame {
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

// `shoulderExpand` (default 0, unused by active/standby — only the domain
// ambient-presence glyph passes it) widens the shoulders symmetrically in
// place, for a "breathing" spatial cue without changing intensity. 0 leaves
// the geometry byte-identical to before this param existed.
function drawHkFurniture(f: Frame, deskV: number, headShoulderV: number, shoulderExpand = 0): void {
  hline(f, HK_DESK_X0, HK_DESK_X1, HK_DESK_Y, deskV);
  vline(f, 22, 19, 22, 1);
  vline(f, 42, 19, 22, 1);
  fillRect(f, 30, 8, 5, 4, headShoulderV); // head
  fillRect(f, 28 - shoulderExpand, 12, 9 + shoulderExpand * 2, 5, headShoulderV); // shoulders
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

// 2-1b — the ECG glyph family: a real PQRST waveform in every state, an
// AFib rhythm whenever something's amiss, always-AFib while actively
// diagnosing (that only happens because something failed). Shared by
// standby (resting sinus), domain (sinus/AFib on unresolved CI red — see
// Task 1's derivePurview()["2-1b"].secondary), and active (always AFib).
//
// "One continuous pen-line" contract (pen-line wave, 2026-07-28): every
// state's trace — baseline AND complexes alike — renders at the SAME bulk
// intensity (the state's own v; only the R-tip gets the tipV accent), and
// every segment is either drawn as a run of Chebyshev-adjacent pixels or
// explicitly bridged with columnFillLine (see tracePointPlotter,
// drawAfibWavelets). A real ECG strip never shows the pen lifting, including
// in the fibrillatory baseline between AFib beats — see each caller
// (activeGlyphs, domainGlyphs, standbyGlyphs) for why their baseline hline
// uses the bulk v rather than a dimmer fixed value.
//
// Column-fill bridging (column-fill wave, 2026-07-28): plotLine's Bresenham
// bridge plots one cell per step, so consecutive cells on a steep run are
// only diagonally (Chebyshev) adjacent — at the DMD's round-dot pitch that
// reads as a chain of corner-touching dots with a visible gap at each seam,
// not a solid stroke (the user's side-by-side screenshot against the live
// board caught this on the R up/downstrokes, the S recovery, and the P/T
// shoulders). columnFillLine instead fills the FULL vertical span the ideal
// line crosses in every column it visits — like a real scope rasterizer —
// so a steep stroke renders as a run of solid vertical dot-bars, each pair
// of adjacent columns sharing a full pixel edge (von Neumann adjacency), not
// just a touching corner. Shallow segments (the P/T flanks, the AFib
// wavelets) are visually unaffected — their per-column span is 1-2 rows
// either way, the same as a Bresenham step would draw.

// One full PQRST complex, 22px wide (dx 0-21) starting at xOrigin (wrapped
// into the board so a complex scrolling near the edge continues on the
// opposite side rather than clipping). `opts.v` is the bulk intensity for
// every segment except the R-wave apex, which gets `opts.tipV` — the ≤2px
// v=3 accent domain/active budget in the module-level comment block refers
// to. The PR and ST segments are intentionally flat (no px calls): the
// baseline hline every caller draws already covers them.
//
// Morphology wave (2026-07-28, textbook-lead-II pass): the original 16px
// complex read as a cramped blob against a real ECG reference — R wasn't
// dominant, P/T were 1-2px specks instead of rounded arcs, and everything
// was too cramped to read. This redesign widens P to a genuine 5-column
// rounded hump, T to an 8-column broad rounded arc (the widest wave in the
// complex, per the reference), and narrows/heightens the QRS so R is
// unambiguously the towering feature (13px tall vs P's 5px and T's 7px —
// several times either). See each segment's own comment below for exact
// proportions.
//
// Amplitude wave (2026-07-28): the morphology pass above got the SHAPE
// right but was still too shallow to read as a clear image on the actual
// board — R's 10px apex left headroom above it unused, and the Q/S
// undershoot wasn't pronounced against the baseline. This pass rescales
// every segment's height (domain baseline also drops 12->14 to buy more
// headroom on both sides — see domainGlyphs["2-1b"]) while keeping every
// dx position, the P/T rounded-arc shape, and the pen-line/bridging
// contracts exactly as they were: only the dy magnitudes changed.
// Shared point-plotter for both PQRST families (drawPqrst, drawAfibComplex):
// draws each sample point via px(), and — when `bridge` is set — connects it
// to the PREVIOUS point with columnFillLine at `bridgeV` first, so a steep
// run (e.g. the QRS's Q-R-S strokes, which cross 5-8 rows in a single
// x-step) renders as a run of solid vertical dot-bars instead of an isolated
// per-column dot (fix round 2: the trace previously plotted one px per
// column, leaving the QRS limbs as scattered dots exactly like the heart
// ring's round-1 bug) or a diagonally-corner-touching Bresenham stair-step
// (column-fill wave: still readable as gapped at the DMD's dot pitch — see
// columnFillLine's own comment).
// Callers still write the point's own intensity via px() AFTER the bridge,
// so an R-tip's tipV always wins over the bridge's bulk v (px is max-blend:
// see frame.ts) — the tip stays exactly the apex pixel(s), never diluted to
// bulk.
//
// The bridge is monotonic-x only: it's skipped whenever the previous and
// current point's UNWRAPPED raw x fall in different wrapX periods (a
// complex scrolling near the board edge can have its early columns land
// past x=63 into the next period while its later columns are still in the
// current one — see wrapX). Bridging across that seam would draw backward
// across nearly the whole board instead of the short local segment
// intended. The point itself is always still drawn via px() in that case —
// only the interpolated stroke between it and its predecessor is skipped.
//
// Most points in a complex have two edges (bridged both to their
// predecessor and, via the next call, to their successor), so losing one to
// a seam-skip still leaves the other. But a few points are chain DEAD ENDS
// — bridged from their predecessor only, with no forward bridge (P1 and the
// final S sample: the PR/ST gaps are deliberately left unbridged so those
// segments stay flat) — and aren't within Chebyshev-1 of the baseline hline
// either (P1 sits 2px above it, the final S sample 2px below). For those,
// pass `anchorIfUnbridged: true`: if their sole edge gets cut by the seam
// guard, a short same-column connector down/up to the baseline is drawn
// instead, so the point is never left with zero neighbors. This connector
// only ever appears in the rare frame where that exact point straddles the
// sweep seam — it changes nothing in the far more common unwrapped case.
function tracePointPlotter(
  f: Frame,
  xOrigin: number,
  baselineY: number,
  bridgeV: number,
): (
  dx: number,
  dy: number,
  intensity: number,
  bridge?: boolean,
  anchorIfUnbridged?: boolean,
) => void {
  let prevRawX: number | null = null;
  let prevY = 0;
  return (dx, dy, intensity, bridge = false, anchorIfUnbridged = false) => {
    const rawX = xOrigin + dx;
    const y = baselineY + dy;
    const wrappedX = wrapX(rawX);
    let bridged = false;
    if (bridge && prevRawX !== null && Math.floor(prevRawX / DMD_W) === Math.floor(rawX / DMD_W)) {
      // Fix round 1 (apex-widening P1, 2026-07-28): when this point's own
      // intensity is a higher-tier accent than the bridge's bulk `bridgeV`
      // (an R-tip), the bridge must reserve the destination's exact row for
      // the caller's own accent write below — see columnFillLine's
      // `reserveDestinationRow` param.
      columnFillLine(f, wrapX(prevRawX), prevY, wrappedX, y, bridgeV, intensity > bridgeV);
      bridged = true;
    }
    if (bridge && !bridged && anchorIfUnbridged) {
      columnFillLine(f, wrappedX, y, wrappedX, baselineY, bridgeV);
    }
    px(f, wrappedX, y, intensity);
    prevRawX = rawX;
    prevY = y;
  };
}

function drawPqrst(
  f: Frame,
  xOrigin: number,
  baselineY: number,
  opts: { v: number; tipV: number },
): void {
  const { v, tipV } = opts;
  const put = tracePointPlotter(f, xOrigin, baselineY, v);
  // P wave: a small ROUNDED hump, 5 columns wide (dx 0-4), symmetric
  // rise-then-fall of 5 rows (amplitude wave, 2026-07-28: was 2 rows —
  // scaled up along with the rest of the complex, still clearly subordinate
  // to R's 13-row spike), starting and ending exactly on the baseline so no
  // chain-dead-end anchor is needed at either end (both endpoints sit at
  // dy=0 — always Chebyshev-adjacent to the baseline hline regardless of
  // whether their own bridge survives a wrap-seam skip). The peak (dx=2,
  // baseline-5) is also the sinus/AFib discriminator used by the test
  // suite — AFib's fibrillatory jitter is contractually only ±1px, so it
  // can never land here. The rise/fall passes through row baseline-2 (the
  // discriminator's own scan row) on both flanks, so the widened hump keeps
  // firing the same window it always did — see pRegionLit in the test
  // suite.
  //
  // NOTE for the discriminator window: the test suite's rColumns() scans
  // for the topmost lit row per column and thresholds at y<6 to isolate the
  // R-spike. The R upstroke->tip bridge (dx 8->9, a steep climb in one
  // x-step) is steep enough that it ALSO dips below that threshold at dx=8
  // (one column left of the tip's own dx=9-10) — verified empirically.
  // Fix round 1 (hardening, 2026-07-28): rColumns() now groups adjacent
  // below-threshold columns and reports each group's TRUE apex (its own
  // minimum-y pixel) rather than the first column encountered in the
  // group — that decouples "the" R column from the upstroke bridge's exact
  // steepness, so it correctly resolves to dx=9 (the tip's own start, a
  // 2-way tie with dx=10 broken to the first), not dx=8. The P peak (dx=2)
  // sits 7 columns before that apex column. The discriminator window in the
  // test suite is centered on that empirically-verified -7. See the
  // "2-1b PQRST" describe block's recalibration-proof test and its
  // bridge-crossing plant (which pins the Q->R-upstroke bridge's OWN
  // baseline-2 crossing, at relative offset -1 from the apex column — the
  // artifact this note is warning about — to prove the window excludes it).
  put(0, 0, v);
  put(1, -3, v, true);
  put(2, -5, v, true); // P peak
  put(3, -3, v, true);
  put(4, 0, v, true);
  // dx 5-6: flat PR segment (baseline hline covers it) — intentionally NOT
  // bridged from the P wave into Q, so the isoelectric segment stays flat.
  put(7, 2, v); // Q dip
  // Q's own forward edge (into the R upstroke, next) is a normal bridge, but
  // that bridge is skipped at the rare wrap-seam straddle (tracePointPlotter's
  // monotonic-x guard) — and unlike the pre-amplitude-wave Q (dy=1, always
  // Chebyshev-1 from the baseline hline for free), Q now sits 2 rows below
  // baseline (amplitude wave, 2026-07-28), too far to fall back on hline
  // adjacency alone. A direct one-row connector closes that gap
  // unconditionally (harmless overlap with the normal bridge otherwise —
  // px() is max-blend), keeping Q chain-connected in every case, seam or not.
  px(f, wrapX(xOrigin + 7), baselineY + 1, v);
  // R spike: narrow and TOWERING — the dominant vertical feature by a wide
  // margin over both P (5 rows) and T (7 rows). Upstroke/downstroke at bulk
  // v, bridged; the apex (dx 9-10, 2px wide) is the tip accent, 13px above
  // baseline (amplitude wave, 2026-07-28: was 10px) — reaches y≈1 off a
  // y=14 domain baseline and y≈3 off a y=16 standby baseline, near-touching
  // the top of the scene band (rows 0-23) at domain — bridged in but
  // written at tipV so it wins the max-blend over the bridge's own bulk-v
  // pass through that same pixel.
  put(8, -7, v, true); // R upstroke
  put(9, -13, tipV, true); // R tip
  put(10, -13, tipV, true); // R tip (2nd px)
  // S: sharp undershoot below baseline — chain dead end (ST gap unbridged
  // forward), 6px from baseline (amplitude wave: was 5) so it needs the
  // anchor. This bridge's SOURCE is the tip's own column (dx=10, already
  // tipV at the apex row) — bulk-v filling through that row again is a
  // max-blend no-op, not a new widening (fix round 1's reserveDestinationRow
  // fix only applies when the DESTINATION is the accent, which S isn't).
  put(11, 6, v, true, true);
  // dx 12-13: flat ST segment (baseline hline covers it) — intentionally NOT
  // bridged from S into T, matching the PR segment's flat treatment.
  // T wave: the WIDEST wave in the complex — 8 columns (dx 14-21), a smooth
  // rounded arc rising 7 rows (amplitude wave: was 3) with a 2-column flat
  // top (dx 17-18) for a genuinely rounded (not peaked) hump, matching the
  // textbook reference. Like the P wave, both endpoints sit at dy=0 so no
  // anchor is needed.
  put(14, 0, v);
  put(15, -2, v, true);
  put(16, -5, v, true);
  put(17, -7, v, true); // T peak (sustained across dx 17-18)
  put(18, -7, v, true);
  put(19, -5, v, true);
  put(20, -2, v, true);
  put(21, 0, v, true);
}

// AFib fibrillatory baseline: a CONNECTED undulating polyline, not isolated
// jitter dots. Round 3 fix (pen-line wave, 2026-07-28): the original version
// drew independent ±1px specks at v=1, one decision per column — at the
// painter's alpha ramp (levelAlpha in palette.ts: v=1 is 25% alpha, v=2 is
// 55%) those specks read as disconnected flecks rather than the wavering,
// never-lifts-the-pen baseline a real AFib strip shows. This now samples a
// jitter y every 2-3 columns (a real f-wave doesn't resolve at every pixel
// either) and bridges consecutive samples with columnFillLine via the shared
// tracePointPlotter, so the baseline between spikes is one continuous chain.
// Renders at `v` — the caller's bulk intensity, not a fixed dim value — so
// it reads with the same weight as the rest of the trace (see the module's
// "uniform trace intensity" contract, drawSinusBeats/drawAfib callers).
// Amplitude is unchanged at ±1px (dy in {-1, 0, 1}, same 35/35/30
// down/up/flat split as the old per-column version) specifically so the
// P-absence discriminator (pRegionLit in glyphs.test.ts, which checks row
// baseline-2) is never at risk — the wavelets never reach past baseline±1.
// Seeded on a sample index `i` plus a `floor(tMs/160)` time bucket (the ×97
// spreads the bucket into a distinct region of the seed space, matching the
// old per-column scheme) — deterministic per frame, changes ~6x/sec. The
// step and the jitter share one mulberry32 draw per sample rather than two
// independent streams: this is a texture generator, not a physically-modeled
// signal, so a little correlation between "how far" and "which way" is an
// acceptable simplicity trade, not a determinism or discriminator risk.
function drawAfibWavelets(f: Frame, baselineY: number, tMs: number, v: number): void {
  const bucket = Math.floor(tMs / 160);
  const put = tracePointPlotter(f, 0, baselineY, v);
  let x = 0;
  let i = 0;
  while (x < DMD_W) {
    const rand = mulberry32(i + bucket * 97);
    const r = rand();
    const dy = r < 0.35 ? -1 : r < 0.7 ? 1 : 0;
    put(x, dy, v, i > 0);
    const step = 2 + Math.floor(rand() * 2); // 2 or 3 columns to the next sample
    x += step;
    i++;
  }
}

// One AFib complex: no P wave, just a narrow Q-R-S (the irregular timing
// lives in the caller). `ampAdjust` varies the R-wave height ±2px from the
// contract's 11px base, clamped to stay a legible spike AND to the
// available headroom off `baselineY` (see below). Tip is 2px wide
// (x, x+1) at `tipV`, matching the same accent budget as the sinus R-tip.
//
// Morphology wave (2026-07-28): raised the base height (9->11, so AFib's R
// reads at least as tall as sinus's R) and deepened S into a REAL
// undershoot (was +2, now +6) so AFib's own QRS is legible on its own
// merits — not just "irregular", but visibly a well-formed-if-chaotic spike
// train, contrasting against sinus's rounded P/T rather than looking like a
// degenerate scribble next to it.
//
// Fix round 1, P1 (2026-07-28): the height budget used to be a flat
// clamp(.., 8, 14) regardless of baseline. At the (then) domain baseline
// (y=12), a jittered h of 13-14 sends the tip to y<=-1 — px()'s bounds
// check silently no-ops it, so the beat rendered flat-topped with ZERO v=3
// pixels (a reviewer sweep found this in ~10.5% of frames at primary=1).
// The active baseline (y=16) had enough headroom (min tip y=2) to never
// trigger it. Fix: cap h so the tip never goes above row 1
// (`baselineY - 1`), which COMPRESSES the jitter range at low baselines
// rather than deleting the variation outright.
//
// Amplitude wave (2026-07-28): the domain baseline dropped 12->14 (see
// domainGlyphs["2-1b"]), which raises this clamp's ceiling for free — domain
// now reaches h ∈ [9,13] (min(14, 14-1)=13, so the tip can reach row 1, near
// the top of the scene band, matching sinus's own R apex) instead of the old
// [9,11]. Active is unaffected (min(14, 16-1)=14, already at its ceiling
// before this wave).
function drawAfibComplex(
  f: Frame,
  x: number,
  baselineY: number,
  v: number,
  tipV: number,
  ampAdjust: number,
): void {
  const h = clamp(11 + ampAdjust, 8, Math.min(14, baselineY - 1));
  // Same bridging shape as drawPqrst's QRS (see tracePointPlotter) — no P
  // wave here (that's the point: AFib has none), so the whole complex is
  // one continuous Q-R-S stroke with no flat gaps to skip.
  const put = tracePointPlotter(f, x, baselineY, v);
  put(-2, 1, v); // Q
  put(-1, -5, v, true); // R upstroke
  put(0, -h, tipV, true); // R tip
  put(1, -h, tipV, true); // R tip (2nd px)
  put(2, -5, v, true); // R downstroke
  // S: real undershoot below baseline — chain dead end (no forward point),
  // 6px out so it needs the anchor. Both this bridge and the downstroke
  // bridge above have the tip's own column as their SOURCE (already tipV at
  // the apex row), never a DESTINATION — fix round 1's reserveDestinationRow
  // only fires when the accent is the destination, so these are unaffected.
  put(3, 6, v, true, true);
}

// Shared AFib renderer, parameterized by the caller's intensity budget.
// Complex positions come from a mulberry32 stream seeded on a "sweep-index
// bucket" (one full board-width scroll at the same 80ms/px rate the sinus
// trace uses = 5120ms/sweep) — bit-stable for any tMs within a sweep, but a
// fresh irregular layout each sweep. Beat count still scales with
// clamp(primary, 1, 6) so CI load stays legible even in AFib. The same rand
// stream also drives each beat's R-amplitude jitter ("from the same
// stream", per the waveform contract), so gaps and amplitudes are both
// deterministic in (tMs, beats) without a second seed to keep in sync.
function drawAfib(
  f: Frame,
  baselineY: number,
  tMs: number,
  beats: number,
  v: number,
  tipV: number,
): void {
  drawAfibWavelets(f, baselineY, tMs, v);
  const sweepMs = 5120;
  const sweepIdx = Math.floor(tMs / sweepMs);
  const rand = mulberry32(sweepIdx * 733 + beats * 31);
  const base = DMD_W / beats;
  const scroll = Math.floor(tMs / 80) % DMD_W;
  for (let i = 0; i < beats; i++) {
    const jitter = Math.round((rand() - 0.5) * base * 0.8);
    const amp = Math.round((rand() - 0.5) * 4); // ±2px
    const x = Math.round(base * (i + 0.5)) + jitter + scroll;
    drawAfibComplex(f, x, baselineY, v, tipV, amp);
  }
}

// 2-1b — active (diagnosing): ALWAYS AFib. Diagnosing only happens because
// something failed, so there's no sinus-rhythm active state to render.
// Full brightness bulk (2) with a v=3 tip — active's budget is otherwise
// unrestricted, but a heavier bulk would crowd the trace past readability.
// The baseline hline renders at the SAME bulk v (2), not a dimmer fixed
// value — see the "uniform trace intensity" pen-line fix (2026-07-28): a
// real ECG is one continuous stroke, so the flat run between beats reads at
// the same weight as the beats themselves, not as a separate dim guide-line.
activeGlyphs["2-1b"] = (t, counts) => {
  const f = blank();
  const baselineY = 16;
  hline(f, 0, DMD_W - 1, baselineY, 2);
  const beats = clamp(counts.primary, 1, 6);
  drawAfib(f, baselineY, t, beats, 2, 3);
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

// Sinus beat-count rescale (morphology wave, 2026-07-28): drawPqrst widened
// from 16px to a real 22px sinus morphology (P/QRS/T each need genuine
// room — see drawPqrst's own comment), so it can no longer fit up to 6
// complexes across the 64px board the way the old `clamp(primary, 1, 6)`
// mapping did — 6 complexes at 22px each is 132px, more than double the
// board width. DECISION: domain load now renders as AT MOST 2 full
// complexes (clamp(primary, 1, 2)) — legibility of the morphology wins over
// cramming more beats in — with the honest load signal moved into R-R
// SPACING instead: a single beat at primary<=1, then two beats whose gap
// shrinks from 32px (primary=2) to 26px (primary>=6) as CI load rises.
// 26px still clears the complex's own 22px footprint (dx 0-21), so the two
// beats never visually merge even at maximum compression. The saturation
// point (primary=6) is deliberately the SAME value the old beat-count cap
// used, so the existing "ceiling clamp still holds" invariant
// (dom(6)≡dom(10)) survives this rescale unchanged in form — it's now a
// spacing ceiling instead of a beat-count ceiling, but it's still the same
// primary=6 saturation point being pinned.
//
// AFib keeps the old clamp(primary, 1, 6): drawAfibComplex is only ~6px
// wide (Q at dx-2 to S at dx+3), so the width problem this rescale exists
// to fix never applied there. Left alone, AFib's beat count now reads as
// MORE dense/chaotic relative to sinus's sparser 1-2 beats — reinforcing
// (not undermining) the intended contrast between a chaotic rhythm and an
// obviously well-formed one.
const SINUS_RR_GAP_LO = 26; // px, at primary>=6 (saturated)
const SINUS_RR_GAP_HI = 32; // px, at primary<=2
const SINUS_R_OFFSET = 9; // dx of the R-tip's first column within drawPqrst

function drawSinusBeats(f: Frame, baselineY: number, t: number, primary: number): void {
  const scroll = Math.floor(t / 80) % DMD_W;
  const opts = { v: 2, tipV: 3 };
  if (primary <= 1) {
    drawPqrst(f, Math.round(DMD_W / 2 - SINUS_R_OFFSET) + scroll, baselineY, opts);
    return;
  }
  const loadClamped = clamp(primary, 2, 6);
  const gap = SINUS_RR_GAP_HI - ((loadClamped - 2) / 4) * (SINUS_RR_GAP_HI - SINUS_RR_GAP_LO);
  const half = gap / 2;
  drawPqrst(f, Math.round(DMD_W / 2 - half - SINUS_R_OFFSET) + scroll, baselineY, opts);
  drawPqrst(f, Math.round(DMD_W / 2 + half - SINUS_R_OFFSET) + scroll, baselineY, opts);
}

// 2-1b — domain: load-scaled ECG, sinus or AFib depending on whether CI is
// amiss, baselined above the active glyph's so the two read as distinct
// instruments. `amiss` (unresolved-red count on an incomplete chain —
// Task 1's derivePurview()["2-1b"].secondary) switches sinus to AFib at the
// same intensity budget: bulk stays at 2, the R-tip accent stays a ≤2px v=3
// per beat. See drawSinusBeats for the sinus beat-count rescale this wave
// introduced. Baseline renders at the same bulk v=2 as the trace itself
// (pen-line fix, 2026-07-28) — see activeGlyphs["2-1b"]'s comment for why.
//
// Baseline 12->14 (amplitude wave, 2026-07-28): dropped 2 rows to buy more
// headroom for the taller R spike (drawPqrst's amplitude wave) without
// crowding the R-tip toward row 0 — also directly benefits AFib's own
// baseline-aware height clamp (drawAfibComplex's `min(14, baselineY-1)`),
// which now reaches its full 13px cap instead of being capped at 11.
domainGlyphs["2-1b"] = (t, counts) => {
  const f = blank();
  const baselineY = 14;
  hline(f, 0, DMD_W - 1, baselineY, 2);
  const amiss = counts.secondary > 0;
  if (amiss) {
    const beats = clamp(counts.primary, 1, 6);
    drawAfib(f, baselineY, t, beats, 2, 3);
  } else {
    drawSinusBeats(f, baselineY, t, counts.primary);
  }
  return f;
};

// A packing slip (~3x2, v=2) dropping into the open box from above, in 4
// discrete steps (blocky motion, matching the belt's own stepped idiom
// rather than a smooth glide): 2 steps still above the box (visible in the
// open air over the flaps), then 2 steps settled inside the interior. Only
// called while the flaps are open (p < 0.45) — it isn't drawn again once
// folding starts, so it reads as "settled inside, then occluded" rather
// than lingering through the fold.
function drawPackingSlip(f: Frame, x: number, boxTop: number, dropP: number): void {
  const steps = 4;
  const stepIdx = Math.min(steps - 1, Math.floor(clamp(dropP, 0, 0.999) * steps));
  const ys = [boxTop - 5, boxTop - 2, boxTop + 1, boxTop + 4]; // above -> above -> inside -> inside
  fillRect(f, x + 4, ys[stepIdx] ?? (ys[3] as number), 3, 2, 2);
}

// Flap fold: each flap is a short (3px) line hinged at its box-top corner,
// animated through 4 keyframes — outward-up, upright, angled inward, then
// flat (folded onto the top edge) — mirrored left/right. Quantized to
// discrete keyframes (not interpolated) for the same blocky-motion reason
// as the packing slip. All strokes are v=2 — this phase never touches the
// v=3 tape-gun budget (see the domain glyph's intensity-budget comment).
function drawFoldingFlaps(f: Frame, x: number, boxTop: number, boxW: number, foldP: number): void {
  const kfCount = 4;
  const kf = Math.min(kfCount - 1, Math.floor(clamp(foldP, 0, 0.999) * kfCount));
  if (kf === 3) {
    // Fully folded flat — the same top-edge treatment the tape pass expects
    // to start from.
    hline(f, x, x + boxW - 1, boxTop, 2);
    return;
  }
  // Tip offset (dx, dy) from each hinge corner: outward-up -> upright ->
  // inward. Left and right mirror around the box's vertical centerline.
  const leftTip: readonly [number, number] = kf === 0 ? [-3, -3] : kf === 1 ? [0, -3] : [3, -3];
  const rightTip: readonly [number, number] = kf === 0 ? [3, -3] : kf === 1 ? [0, -3] : [-3, -3];
  const leftHingeX = x;
  const rightHingeX = x + boxW - 1;
  plotLine(f, leftHingeX, boxTop, leftHingeX + leftTip[0], boxTop + leftTip[1], 2);
  plotLine(f, rightHingeX, boxTop, rightHingeX + rightTip[0], boxTop + rightTip[1], 2);
}

// tt-8l shipping-department box states, driven by phase p in [0, 1) of the
// per-box cycle. Body is a fixed 12x8 outline at y=14; only its x position
// and the top-edge treatment change across the phase: slide-in (open flaps)
// -> packing slip drops in (flaps still open) -> flaps fold closed (hinged,
// angular keyframes) -> tape pass -> slide out sealed.
function drawShippingBox(f: Frame, p: number): void {
  const boxTop = 14;
  const boxW = 12;
  let x: number;
  if (p < 0.3) {
    x = Math.round(-14 + (p / 0.3) * 40); // slide in: -14 -> 26
  } else if (p < 0.75) {
    x = 26; // parked: paper drop, flap fold, tape pass
  } else {
    x = Math.round(26 + ((p - 0.75) / 0.25) * 40); // slide out: 26 -> 66
  }
  rect(f, x, boxTop, boxW, 8, 2);

  if (p < 0.3) {
    // Open flaps, angled outward-up — the slide-in look, unchanged.
    for (let i = 1; i <= 3; i++) {
      px(f, x - i, boxTop - i, 2);
      px(f, x + boxW - 1 + i, boxTop - i, 2);
    }
  } else if (p < 0.45) {
    // Flaps stay open while the packing slip drops in.
    for (let i = 1; i <= 3; i++) {
      px(f, x - i, boxTop - i, 2);
      px(f, x + boxW - 1 + i, boxTop - i, 2);
    }
    drawPackingSlip(f, x, boxTop, (p - 0.3) / 0.15);
  } else if (p < 0.6) {
    drawFoldingFlaps(f, x, boxTop, boxW, (p - 0.45) / 0.15);
  } else if (p < 0.75) {
    // Tape pass: the sealed trail behind the gun stays bulk v=2 (the global
    // domain rule caps v=3 to small accents, not a growing hline) — only the
    // gun's leading edge gets a <=2px v=3 accent riding at its head.
    const tapeX = x + Math.round(((p - 0.6) / 0.15) * (boxW - 1));
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
//
// `elapsedMs` is ms since THIS celebration span began — not the free-running
// animation clock. Anchoring the climb to a modulo of the free-running clock
// (the previous implementation) let the arc's phase at celebration-start be
// whatever the clock happened to read, so the rocket could open mid-climb,
// wrap to the pad, and relaunch within a single 3s celebration. The caller
// (dmd/controller.ts) is responsible for computing elapsedMs relative to the
// celebration's actual start.
export function blastOffFrame(elapsedMs: number): Frame {
  const f = blank();
  hline(f, 40, 60, 22, 1);
  const progress = clamp(elapsedMs, 0, 3000) / 3000;
  const riseY = Math.round(progress * 22); // body top climbs y=8 -> y=-14
  drawRocketAt(f, riseY, 2);
  const bodyBottom = 8 - riseY + 14;
  const rand = mulberry32(Math.floor(elapsedMs / 90));
  const cols = 2 + Math.round(progress); // widens 2 -> 3 as it climbs
  for (let i = 0; i < cols; i++) {
    const cx = 50 + i - Math.floor(cols / 2) + (Math.floor(rand() * 3) - 1);
    const len = 2 + Math.floor(rand() * 3);
    vline(f, cx, bodyBottom, Math.min(23, bodyBottom + len), 3);
  }
  return f;
}

// Bresenham line: plots every integer cell from (x0,y0) to (x1,y1) so each
// step is Chebyshev-adjacent to the last — a general-purpose continuity
// primitive for outline/silhouette strokes, where a diagonal chain of
// corner-touching dots is the correct look (matches how the rest of an
// outline's curve samples land). Two independent users remain: drawHeartRing
// (fix round 1: at r≈8-12 the cusp-heavy heart parametrization spaces
// consecutive rounded samples more than 1px apart on the flanks, fragmenting
// the outline into scatter) and drawFoldingFlaps (the tt-8l shipping box's
// hinged flap strokes — unrelated to the ECG family this file also draws).
// The ECG trace itself moved OFF this primitive in the column-fill wave
// (2026-07-28) — see columnFillLine below and tracePointPlotter's own
// comment for why a diagonal-only bridge reads as gapped at the DMD's
// round-dot pitch on steep strokes, which an outline's all-diagonal curve
// doesn't suffer from since it's diagonal throughout, not intermixed with
// long flat runs the way a waveform's baseline/complex boundary is.
function plotLine(f: Frame, x0: number, y0: number, x1: number, y1: number, v: number): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px(f, x, y, v);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

// Column-fill line: the ECG trace's bridge primitive (column-fill wave,
// 2026-07-28), replacing plotLine for tracePointPlotter's use (see that
// function and the module-level "Column-fill bridging" comment for the
// motivating gap-at-the-seam problem). For each integer column x in
// [x0, x1], fills the FULL vertical span the ideal line crosses in that
// column — like a real oscilloscope rasterizer sweeping columns, not a
// per-cell stair-step. Consecutive columns share their boundary row exactly
// (computed once per boundary, reused as both the outgoing column's exit and
// the incoming column's entry via `boundaryY`), so the fill is orthogonally
// (von Neumann) continuous end to end: every column's span touches its
// neighbor's span at a shared row, not just a shared corner.
//
// Requires x1 >= x0 — the ECG bridge only ever advances left-to-right within
// a wrap period (tracePointPlotter's monotonic-x seam guard already enforces
// this before calling in). A vertical segment (x0 === x1, e.g. the
// anchorIfUnbridged connector down to the baseline) is the degenerate case:
// fill the plain min..max span in that one column, same as vline would.
//
// `reserveDestinationRow` — apex-widening fix (fix round 1, 2026-07-28): a
// reviewer sweep found the R apex row rendering 3px wide (bulk v beside both
// v=3 tip pixels) in ~97% of beats. The original apex-safety reasoning here
// was incomplete: for a single-column bridge INTO the tip, the whole span
// landing in the SOURCE column (x0) includes the destination's own row
// (y1) whenever the segment is steep enough to reach it in one column —
// which the upstroke->tip bridge always is — painting bulk v into the
// column beside the tip at the tip's own row. Pass true when this bridge's
// destination point will be drawn at a HIGHER intensity than this bridge's
// bulk `v` (an accent like an R-tip): the fill's target then shrinks by one
// row toward the origin (the "shaft" row, one step before the accent), and
// that shaft row — not the accent row itself — is the one carried into the
// destination column, explicitly, via a bulk px() write. The accent row is
// left completely untouched by this function, reserved for the caller's own
// higher-intensity px() write (in tracePointPlotter, immediately after this
// call returns). Orthogonal adjacency still holds: the source column's fill
// and the destination's shaft pixel share that one shifted row. For a flat
// bridge (rise 0 — e.g. the tip's own 2nd px, bridged from its 1st at the
// same row) the shift is a no-op (there's no "row before" when there's no
// direction), so passing this flag is always safe to compute purely from
// "is the destination an accent", independent of the segment's slope — see
// tracePointPlotter's call site: `intensity > bridgeV` is computed fresh
// per point, no slope check needed. A bridge OUT of the tip (into the
// downstroke/S point) has the tip's own column as the SOURCE, not the
// destination — that bridge's destination is a bulk-v point, so
// `intensity > bridgeV` is false there and this flag naturally does
// nothing; the source column (the tip's own) filling all the way through
// the already-tipV apex row is harmless (px is max-blend, see drawPqrst's
// and drawAfibComplex's own S/downstroke put() comments).
function columnFillLine(
  f: Frame,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  v: number,
  reserveDestinationRow = false,
): void {
  if (x0 === x1) {
    vline(f, x0, Math.min(y0, y1), Math.max(y0, y1), v);
    return;
  }
  const span = x1 - x0;
  const dir = y1 === y0 ? 0 : y1 > y0 ? 1 : -1;
  const targetY = reserveDestinationRow ? y1 - dir : y1;
  const rise = targetY - y0;
  let boundaryY = y0;
  for (let x = x0; x < x1; x++) {
    const nextY = x + 1 === x1 ? targetY : Math.round(y0 + ((x + 1 - x0) / span) * rise);
    vline(f, x, Math.min(boundaryY, nextY), Math.max(boundaryY, nextY), v);
    boundaryY = nextY;
  }
  px(f, x1, targetY, v);
}

// 2-1b — celebrate override: a heart outline instead of the shared diamond
// rings, using the classic parametric heart curve (x = 16·sin³t,
// y = 13·cos t − 5·cos 2t − 2·cos 3t − cos 4t) scaled by r/16 — a real heart
// silhouette (two lobes meeting a V taper to a bottom point) rather than a
// hand-rolled arc approximation, so it reads unambiguously as a heart at
// every ring size instead of only at the hand-tuned r≈8-12 sweet spot.
// Exported so tests can render an isolated single ring (heartCelebrateFrame
// always overlays two) for the continuity structural check.
//
// Fix round 1: sample density now scales with r (`8*r`, floor 48) so the
// curve stays smooth as it grows, AND consecutive samples are bridged with
// plotLine rather than plotted as isolated dots — density alone doesn't
// guarantee adjacency after rounding to integer pixels (the cusps at the
// top-center notch and the bottom point compress many samples into few
// pixels while the flanks spread them out), so the outline needs the
// explicit bridge to stay a single continuous chain at every r.
export function drawHeartRing(f: Frame, cx: number, cy: number, r: number, v: number): void {
  if (r <= 0) {
    px(f, cx, cy, v);
    return;
  }
  const scale = r / 16;
  const steps = Math.max(48, 8 * r);
  const point = (t: number): [number, number] => {
    const hx = 16 * Math.sin(t) ** 3;
    const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    // y is flipped (cy - hy·scale, not cy + hy·scale): the curve's +y is
    // "up" (toward the lobes), but the DMD's y grows downward.
    return [Math.round(cx + hx * scale), Math.round(cy - hy * scale)];
  };
  let [px0, py0] = point(0);
  for (let i = 1; i <= steps; i++) {
    const [px1, py1] = point((i / steps) * Math.PI * 2);
    plotLine(f, px0, py0, px1, py1, v);
    px0 = px1;
    py0 = py1;
  }
}

// Same two-phase expanding-ring cadence as celebrateFrame (growth on
// `(tMs + phase) % 1600`, phases 0/800), but each ring is a heart outline
// instead of a diamond.
function heartCelebrateFrame(tMs: number): Frame {
  const f = blank();
  const cx = DMD_W / 2;
  const cy = DMD_H / 2;
  for (const phase of [0, 800]) {
    const r = Math.floor((((tMs + phase) % 1600) / 1600) * 15);
    drawHeartRing(f, cx, cy, r, 3);
  }
  return f;
}

// hk-47 — domain: the same desk, dimmed, with no sheet and no work motion —
// domain instruments are quiet-monitoring, not a live review. Controller
// ruling (2026-07-27) relaxed the original fully-static rule: ambient motion
// is allowed as long as it never touches the sheet's travel region (no
// reviewing happening) and stays within the shipped intensity caps. The
// droid's own shoulders breathe 0..6 spatial steps on the same 5s triangle
// wave as the standby tray idiom (breathSteps) — "someone is still at the
// desk," spatially alive rather than a single intensity toggle (a binary
// breath() here would only ever produce 2 distinct frames). Max expand
// (6px) keeps the shoulders well clear of the sheet's travel-region columns
// (15-20, 45-50) at every phase. Inbox/outbox stay purely count-driven
// (review backlog reads at a glance, same clamp(0,6) as active).
domainGlyphs["hk-47"] = (t, counts) => {
  const f = blank();
  drawHkFurniture(f, 2, 2, breathSteps(t, 5000, 7));
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
  // hk-47 — the desk at rest: furniture + droid at v=1, both trays empty.
  // Ambient element: the inbox tray FILL COUNT breathes 0..6 items on a 5s
  // triangle wave (the pre-purview "row count varies" idiom, restored, sized
  // to the tray's own natural range) — spatially it reads as paper
  // arriving/clearing a sheet at a time, not one line toggling brightness.
  "hk-47": (t) => {
    const f = blank();
    drawHkFurniture(f, 1, 1);
    drawHkTray(f, HK_INBOX_X0, HK_INBOX_X1, breathSteps(t, 5000, 7), 2);
    hline(f, HK_OUTBOX_X0, HK_OUTBOX_X1, HK_TRAY_Y, 1);
    return f;
  },

  // 2-1b — resting sinus: a single full PQRST complex sweeping the width
  // once every 5s (replacing the old flat-baseline blip). Capped at v=2
  // everywhere, including the R-tip — standby never gets the v=3 accent
  // domain/active use. Baseline renders at that same v=2 (pen-line fix,
  // 2026-07-28), not a dimmer fixed value — see activeGlyphs["2-1b"]'s
  // comment for why.
  "2-1b": (t) => {
    const f = blank();
    const baselineY = 16;
    hline(f, 0, DMD_W - 1, baselineY, 2);
    const period = 5000;
    const xOrigin = Math.floor(((t % period) / period) * DMD_W);
    drawPqrst(f, xOrigin, baselineY, { v: 2, tipV: 2 });
    return f;
  },

  // tt-8l — the belt at rest: no boxes moving, an empty flat-packed box
  // outline breathing 1..2 on 5s, plus the shared idling-conveyor accent
  // (drawDriftingAccent) drifting along the belt line so the belt itself
  // reads as idling rather than a still photograph.
  "tt-8l": (t) => {
    const f = blank();
    hline(f, 0, DMD_W - 1, 22, 1);
    drawDriftingAccent(f, 22, t);
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
  // outline breathes 1..2 on 5s, plus the shared idling-conveyor accent
  // (drawDriftingAccent) drifting along the belt — skipping the arch span so
  // the drift reads as running under the fixture, not through it.
  r5: (t) => {
    const f = blank();
    drawR5Belt(f, 1, 1);
    drawDriftingAccent(f, R5_BELT_Y, t, R5_ARCH_X, R5_ARCH_X + R5_ARCH_W);
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
  // tt-8l's celebrate case ONLY: ms since the current celebration span
  // began (see blastOffFrame). Every other droid's celebrate render
  // (celebrateFrame, the diamond rings) stays phase-agnostic on tMs — a
  // dedicated param rather than a GlyphCounts field keeps that scene from
  // having to know or care about celebration timing at all. Defaults to 0
  // (rocket on the pad) rather than falling back to tMs, so a caller that
  // forgets to thread the real value gets an inert-but-honest frame instead
  // of resurrecting the old mid-climb-start bug.
  celebrateElapsedMs?: number,
): Frame {
  switch (state) {
    case "idle":
      return (standbyGlyphs[droid] ?? idleFrame)(tMs);
    case "cooling":
      return coolingFrame(droid, tMs);
    case "stale":
      return staleFrame(tMs);
    case "celebrate":
      return droid === "tt-8l"
        ? blastOffFrame(celebrateElapsedMs ?? 0)
        : droid === "2-1b"
          ? heartCelebrateFrame(tMs)
          : celebrateFrame(tMs);
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
