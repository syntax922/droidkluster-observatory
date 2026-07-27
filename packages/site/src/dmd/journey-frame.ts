import type { Frame } from "./frame.js";

// A wide, short frame — one row of stations spanning a pipeline's travel
// axis, not the 64x32 station glyph grid. Kept as local helpers rather than
// widening frame.ts's px/hline/rect (which are hardcoded to DMD_W/DMD_H and
// have existing 64x32 callers in glyphs.ts/painter.ts/controller.ts) — see
// the journey-map design note in CLAUDE.md task history for the rationale.
export const JOURNEY_W = 192;
export const JOURNEY_H = 16;

const STATION_COUNT = 6;
const STATION_MARGIN = 12;
const ROW_Y = Math.floor(JOURNEY_H / 2);
const DOT_PULSE_PX = 0.6;
const TRAIL_MAX_LEVEL = 2;

function blank(): Frame {
  return new Uint8Array(JOURNEY_W * JOURNEY_H);
}

function px(f: Frame, x: number, y: number, v: number): void {
  const xi = Math.round(x);
  if (xi < 0 || xi >= JOURNEY_W || y < 0 || y >= JOURNEY_H) return;
  const i = y * JOURNEY_W + xi;
  if (v > (f[i] ?? 0)) f[i] = v;
}

function fillRect(f: Frame, x: number, y: number, w: number, h: number, v: number): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) px(f, xx, yy, v);
  }
}

// Evenly spaced station x-coordinates across the frame width, margined so
// the first/last station markers (and the traveling dot at their extremes)
// stay fully on-canvas. With JOURNEY_W=192 and STATION_MARGIN=12 this lands
// stations at approximately 12, 46, 79, 113, 146, 180.
function stationX(index: number): number {
  const usable = JOURNEY_W - STATION_MARGIN * 2;
  return STATION_MARGIN + Math.round((usable * index) / (STATION_COUNT - 1));
}

const STATION_XS: readonly number[] = Array.from({ length: STATION_COUNT }, (_, i) => stationX(i));

// Linear position (0..STATION_COUNT-1, fractional) -> x pixel, interpolating
// between the two nearest stations. Out-of-range positions clamp.
function positionToX(position: number): number {
  const clamped = Math.max(0, Math.min(STATION_COUNT - 1, position));
  const lo = Math.floor(clamped);
  const hi = Math.min(STATION_COUNT - 1, lo + 1);
  const frac = clamped - lo;
  const xlo = STATION_XS[lo] ?? 0;
  const xhi = STATION_XS[hi] ?? xlo;
  return xlo + (xhi - xlo) * frac;
}

function drawPath(f: Frame): void {
  const x0 = STATION_XS[0] ?? 0;
  const x1 = STATION_XS[STATION_COUNT - 1] ?? 0;
  for (let x = x0; x <= x1; x += 2) px(f, x, ROW_Y, 1);
}

function drawStations(f: Frame, visited: boolean[], dimmed: boolean): void {
  for (let i = 0; i < STATION_COUNT; i++) {
    const x = STATION_XS[i] ?? 0;
    // Dimmed (stale/idle telemetry): collapse the visited/unvisited diamond
    // distinction to a single flat intensity-1 dot per station — the DMD
    // stale idiom is "dim + motionless", not "dim but still legible as
    // progress". See drawDot()'s matching pulse-off + lower-intensity path.
    if (visited[i] && !dimmed) {
      // ~3px diamond outline: a hair brighter than the dotted path, so a
      // visited station reads as "touched" without competing with the dot.
      px(f, x, ROW_Y - 1, 2);
      px(f, x - 1, ROW_Y, 2);
      px(f, x + 1, ROW_Y, 2);
      px(f, x, ROW_Y + 1, 2);
    } else {
      px(f, x, ROW_Y, 1);
    }
  }
}

function drawTrail(f: Frame, trail: number[]): void {
  // Oldest first, decaying toward the dimmer end; the most recent trail
  // point sits one step behind the live dot and gets the brightest trail
  // level (still below the dot's own intensity 3).
  const n = trail.length;
  trail.forEach((position, i) => {
    const level = n <= 1 ? TRAIL_MAX_LEVEL : 1 + Math.round((i / (n - 1)) * (TRAIL_MAX_LEVEL - 1));
    px(f, positionToX(position), ROW_Y, level);
  });
}

function drawDot(f: Frame, position: number, tMs: number, dimmed: boolean): void {
  // Dimmed: static (no pulse) and one intensity level below the live dot —
  // "frozen at current position" is the caller's job (it passes a position
  // that isn't advancing); this function only needs to stop animating the
  // pulse and step the intensity down to match.
  const pulse = dimmed ? 0 : Math.sin(tMs / 220) * DOT_PULSE_PX;
  const x = Math.round(positionToX(position) + pulse);
  fillRect(f, x - 1, ROW_Y - 1, 3, 3, dimmed ? 2 : 3);
}

export function journeyFrame(
  position: number,
  visited: boolean[],
  trail: number[],
  tMs: number,
  dimmed = false,
): Frame {
  const f = blank();
  drawPath(f);
  drawStations(f, visited, dimmed);
  drawTrail(f, trail);
  drawDot(f, position, tMs, dimmed);
  return f;
}
