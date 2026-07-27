import type { DroidId } from "@observatory/core";
import { JOURNEY_H, JOURNEY_W, journeyFrame } from "./dmd/journey-frame.js";
import { paintGrid } from "./dmd/painter.js";
import { ACCENTS } from "./dmd/palette.js";
import { createTween } from "./journey.js";

export interface LaneState {
  key: string;
  stageIndex: number;
  visited: boolean[];
  droid: DroidId | "system";
  // True when the lane reflects frozen/stale telemetry rather than a live
  // or replay-driven state (see main.ts's stale/onStale/onIdle paths). A
  // dimmed lane freezes at its last interpolated position (no further tween
  // motion) and renders with journeyFrame's dimmed idiom (no pulse, lower
  // intensity) — showing the last-known state honestly instead of implying
  // live progress that isn't happening.
  dimmed: boolean;
}

// Same neutral value as chains.ts's SYSTEM_ACCENT / style.css's --dim —
// system-attributed hops (PR opened, PR merged, CI attributed to no droid)
// get a dim neutral glow rather than an accent color.
const SYSTEM_ACCENT = "#6b7789";

const TICK_MS = 66; // <=15fps, matching dmd/controller.ts
const TRAIL_MAX = 6;

interface LaneRuntime {
  tween: ReturnType<typeof createTween>;
  trail: number[];
  lastStageIndex: number;
  // Set the moment a lane is first observed dimmed; holds the interpolated
  // position at that instant so subsequent dimmed frames keep painting the
  // SAME position (frozen) instead of the tween continuing to run silently
  // underneath. Cleared back to null once the lane is observed non-dimmed
  // again, resuming normal tween-driven motion.
  frozenPosition: number | null;
}

export interface StartJourneysOpts {
  root: HTMLElement;
  getLanes: () => LaneState[];
  now?: () => number;
  raf?: (cb: () => void) => void;
  reducedMotion?: boolean;
  // Test-only seam: inject a paint spy without touching the real canvas
  // painter, mirroring dmd/controller.ts's StartDmdOpts.paint.
  paint?: typeof paintGrid;
}

function accentFor(droid: DroidId | "system"): string {
  return droid === "system" ? SYSTEM_ACCENT : ACCENTS[droid];
}

export function startJourneys(opts: StartJourneysOpts): () => void {
  const now = opts.now ?? (() => performance.now());
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const paint = opts.paint ?? paintGrid;
  const reduced =
    opts.reducedMotion ??
    (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  let stopped = false;
  let lastPaint = 0;
  const runtimes = new Map<string, LaneRuntime>();

  function canvases(): Array<{ el: HTMLCanvasElement; key: string }> {
    return Array.from(
      opts.root.querySelectorAll<HTMLCanvasElement>("canvas[data-journey]"),
      (el) => ({ el, key: el.dataset.journey ?? "" }),
    );
  }

  function pruneRuntimes(liveKeys: Set<string>): void {
    for (const key of runtimes.keys()) {
      if (!liveKeys.has(key)) runtimes.delete(key);
    }
  }

  function runtimeFor(lane: LaneState, atMs: number): LaneRuntime {
    let rt = runtimes.get(lane.key);
    if (!rt) {
      const tween = createTween();
      tween.setTarget(lane.stageIndex, atMs);
      rt = { tween, trail: [], lastStageIndex: lane.stageIndex, frozenPosition: null };
      runtimes.set(lane.key, rt);
    } else if (rt.lastStageIndex !== lane.stageIndex) {
      rt.tween.setTarget(lane.stageIndex, atMs);
      rt.lastStageIndex = lane.stageIndex;
    }
    return rt;
  }

  function paintLane(
    el: HTMLCanvasElement,
    lane: LaneState,
    position: number,
    trail: number[],
    t: number,
  ): void {
    const frame = journeyFrame(position, lane.visited, trail, t, lane.dimmed);
    paint(el, frame, JOURNEY_W, JOURNEY_H, accentFor(lane.droid));
  }

  // Static: current stage only, no tween/pulse/trail. Called unconditionally
  // on a slow interval (see dmd/controller.ts's reduced-motion branch for
  // why this must NOT be a state-key diff: a wholesale-replaced canvas with
  // an unchanged derived key would otherwise never get its first paint).
  // Already motionless regardless of `dimmed` — journeyFrame still lowers
  // the intensity/collapses the station glyph for a dimmed lane so reduced-
  // motion users get the same honesty signal, just without an animation to
  // freeze in the first place.
  function paintAllReduced(): void {
    const lanes = opts.getLanes();
    const laneByKey = new Map(lanes.map((l) => [l.key, l] as const));
    for (const { el, key } of canvases()) {
      const lane = laneByKey.get(key);
      if (!lane) continue;
      paintLane(el, lane, lane.stageIndex, [], 0);
    }
  }

  function paintAllAnimated(t: number): void {
    const lanes = opts.getLanes();
    pruneRuntimes(new Set(lanes.map((l) => l.key)));
    const laneByKey = new Map(lanes.map((l) => [l.key, l] as const));
    for (const { el, key } of canvases()) {
      const lane = laneByKey.get(key);
      if (!lane) continue;
      const rt = runtimeFor(lane, t);

      if (lane.dimmed) {
        // First dimmed tick: snapshot wherever the tween currently is and
        // hold it — no further tween/pulse motion while dimmed persists.
        if (rt.frozenPosition === null) rt.frozenPosition = rt.tween.positionAt(t);
        paintLane(el, lane, rt.frozenPosition, [], t);
        continue;
      }

      rt.frozenPosition = null; // telemetry is live again: resume normal motion
      const position = rt.tween.positionAt(t);
      const trailOnly = rt.trail.slice();
      rt.trail.push(position);
      if (rt.trail.length > TRAIL_MAX) rt.trail.shift();
      paintLane(el, lane, position, trailOnly, t);
    }
  }

  if (reduced) {
    paintAllReduced();
    const timer = setInterval(() => {
      if (stopped) return;
      paintAllReduced();
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  function loop(): void {
    if (stopped) return;
    const t = now();
    if (!document.hidden && t - lastPaint >= TICK_MS) {
      lastPaint = t;
      paintAllAnimated(t);
    }
    raf(loop);
  }
  raf(loop);
  return () => {
    stopped = true;
  };
}
