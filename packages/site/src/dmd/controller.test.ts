import { describe, expect, it, vi } from "vitest";
import { deriveDmdState, startDmd } from "./controller.js";

describe("deriveDmdState", () => {
  const idle = { droid: "r5", state: "idle" } as const;
  const active = { droid: "r5", state: "active", task: "dispatching issue #1" } as const;
  it("stale mode overrides everything", () => {
    expect(deriveDmdState("stale", active, false)).toBe("stale");
  });
  it("celebrating overrides active/idle in live mode", () => {
    expect(deriveDmdState("live", idle, true)).toBe("celebrate");
  });
  it("active droid in live mode animates its glyph", () => {
    expect(deriveDmdState("live", active, false)).toBe("active");
  });
  it("replay mode renders the replayed droid states, not stale", () => {
    expect(deriveDmdState("replay", active, false)).toBe("active");
  });
});

describe("startDmd", () => {
  it("reduced motion schedules no animation frames", () => {
    const raf = vi.fn();
    const root = document.createElement("div");
    root.innerHTML = '<canvas data-dmd="r5" width="192" height="96"></canvas>';
    const stop = startDmd({
      root,
      reducedMotion: true,
      raf,
      getBoard: () => ({
        mode: "live",
        droids: [{ droid: "r5", state: "idle" }],
        celebrating: false,
      }),
    });
    expect(raf).not.toHaveBeenCalled();
    stop();
  });

  it("reduced motion paints unconditionally on the interval, including a freshly re-rendered canvas whose state-key is unchanged", () => {
    vi.useFakeTimers();
    try {
      const paint = vi.fn();
      const root = document.createElement("div");
      root.innerHTML = '<canvas data-dmd="r5" width="192" height="96"></canvas>';
      const stop = startDmd({
        root,
        reducedMotion: true,
        paint,
        getBoard: () => ({
          mode: "live",
          droids: [{ droid: "r5", state: "idle" }],
          celebrating: false,
        }),
      });
      // Immediate paint pass at start.
      expect(paint).toHaveBeenCalledTimes(1);

      // Simulate renderStations() replacing the canvas element wholesale on a
      // poll — the derived state ("r5:idle") is unchanged, but the DOM node
      // is a brand-new, blank canvas. A key-diff would (incorrectly) skip it.
      const freshCanvas = document.createElement("canvas");
      freshCanvas.dataset.dmd = "r5";
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
    root.innerHTML = '<canvas data-dmd="hk-47" width="192" height="96"></canvas>';
    const stop = startDmd({
      root,
      reducedMotion: false,
      raf,
      now: () => 1000,
      getBoard: () => ({
        mode: "live",
        droids: [{ droid: "hk-47", state: "active", task: "reviewing PR #1" }],
        celebrating: false,
      }),
    });
    expect(raf).toHaveBeenCalledTimes(1);
    stop();
    const before = raf.mock.calls.length;
    // TS narrows `queued` to its `null` initializer here since the
    // reassignment happens inside a closure it can't trace through — the
    // cast re-widens the type without changing runtime behavior.
    (queued as (() => void) | null)?.(); // a queued callback firing after stop must not reschedule
    expect(raf.mock.calls.length).toBe(before);
  });
});
