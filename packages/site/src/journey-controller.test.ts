import { describe, expect, it, vi } from "vitest";
import { JOURNEY_H, JOURNEY_W } from "./dmd/journey-frame.js";
import { startJourneys } from "./journey-controller.js";

function laneCanvas(key: string): string {
  return `<canvas data-journey="${key}" width="576" height="48"></canvas>`;
}

const ROW_Y = Math.floor(JOURNEY_H / 2);
const STATION0_X = 12;
const STATION3_X = 113;

// True if any pixel within +-1px of `x` on the station row carries the
// traveling-dot's intensity (3) — a small tolerance for the dot's subtle
// sin()-based pulse offset.
function dotNear(frame: Uint8Array, x: number): boolean {
  for (let dx = -1; dx <= 1; dx++) {
    if ((frame[ROW_Y * JOURNEY_W + x + dx] ?? 0) === 3) return true;
  }
  return false;
}

describe("startJourneys", () => {
  it("reduced motion schedules no animation frames", () => {
    const raf = vi.fn();
    const root = document.createElement("div");
    root.innerHTML = laneCanvas("pr-1");
    const stop = startJourneys({
      root,
      reducedMotion: true,
      raf,
      getLanes: () => [
        {
          key: "pr-1",
          stageIndex: 0,
          visited: [true, false, false, false, false, false],
          droid: "system",
        },
      ],
    });
    expect(raf).not.toHaveBeenCalled();
    stop();
  });

  it("reduced motion paints unconditionally on the interval", () => {
    vi.useFakeTimers();
    try {
      const paint = vi.fn();
      const root = document.createElement("div");
      root.innerHTML = laneCanvas("pr-1");
      const stop = startJourneys({
        root,
        reducedMotion: true,
        paint,
        getLanes: () => [
          {
            key: "pr-1",
            stageIndex: 1,
            visited: [true, true, false, false, false, false],
            droid: "hk-47",
          },
        ],
      });
      expect(paint).toHaveBeenCalledTimes(1); // immediate paint at start

      // Simulate renderJourneys() replacing the canvas wholesale on a poll —
      // same derived state, brand-new DOM node. The interval repaint is
      // unconditional (no state-key diff), so it must still paint this one.
      const freshCanvas = document.createElement("canvas");
      freshCanvas.dataset.journey = "pr-1";
      root.replaceChildren(freshCanvas);

      vi.advanceTimersByTime(2000);
      expect(paint).toHaveBeenCalledTimes(2);
      expect(paint.mock.calls[1]?.[0]).toBe(freshCanvas);

      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("animated mode schedules frames via the injected raf and stop() halts it", () => {
    let queued: (() => void) | null = null;
    const raf = vi.fn((cb: () => void) => {
      queued = cb;
    });
    const root = document.createElement("div");
    root.innerHTML = laneCanvas("pr-1");
    const stop = startJourneys({
      root,
      reducedMotion: false,
      raf,
      now: () => 1000,
      getLanes: () => [
        {
          key: "pr-1",
          stageIndex: 2,
          visited: [true, true, true, false, false, false],
          droid: "2-1b",
        },
      ],
    });
    expect(raf).toHaveBeenCalledTimes(1);
    stop();
    const before = raf.mock.calls.length;
    (queued as (() => void) | null)?.(); // a queued callback firing after stop must not reschedule
    expect(raf.mock.calls.length).toBe(before);
  });

  it("retargets a lane's tween when getLanes reports a new stageIndex", () => {
    const paintedFrames: Uint8Array[] = [];
    const paint = vi.fn((_el: unknown, frame: Uint8Array) => {
      paintedFrames.push(frame);
    });
    let stageIndex = 0;
    let t = 1000;
    let queued: (() => void) | null = null;
    const raf = vi.fn((cb: () => void) => {
      queued = cb;
    });
    const root = document.createElement("div");
    root.innerHTML = laneCanvas("pr-1");
    const visited = [true, true, true, true, false, false];

    const stop = startJourneys({
      root,
      reducedMotion: false,
      raf,
      now: () => t,
      paint,
      getLanes: () => [{ key: "pr-1", stageIndex, visited, droid: "r5" }],
    });

    // Fire the first scheduled frame: lane starts at stage 0, tween settles
    // there immediately (it's the tween's own initial target), so the dot
    // sits at station 0.
    (queued as (() => void) | null)?.();
    expect(paint).toHaveBeenCalledTimes(1);
    expect(dotNear(paintedFrames[0] as Uint8Array, STATION0_X)).toBe(true);
    expect(dotNear(paintedFrames[0] as Uint8Array, STATION3_X)).toBe(false);

    // getLanes now reports stage 3. The next tick (>= TICK_MS later) must
    // observe the change via runtimeFor()'s stageIndex comparison and
    // retarget the tween toward it.
    stageIndex = 3;
    t += 66;
    (queued as (() => void) | null)?.();

    // Advance well past the tween's duration so it settles at the new
    // target — the dot should now sit at station 3, not station 0.
    t += 1000;
    (queued as (() => void) | null)?.();

    const last = paintedFrames[paintedFrames.length - 1] as Uint8Array;
    expect(dotNear(last, STATION3_X)).toBe(true);
    expect(dotNear(last, STATION0_X)).toBe(false);

    stop();
  });
});
