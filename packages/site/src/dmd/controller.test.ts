import { describe, expect, it, vi } from "vitest";
import { COOLING_MIN, deriveDmdState, startDmd } from "./controller.js";
import { dmdFrame } from "./glyphs.js";

const NOW = Date.parse("2026-07-27T12:00:00Z");

describe("deriveDmdState", () => {
  const idle = { droid: "r5", state: "idle" } as const;
  const active = { droid: "r5", state: "active", task: "dispatching issue #1" } as const;
  const recentlyIdle = {
    droid: "r5",
    state: "idle",
    last_action_at: new Date(NOW - 2 * 60_000).toISOString(),
  } as const;
  it("stale mode overrides everything, including an active droid", () => {
    expect(deriveDmdState("stale", active, false, NOW)).toBe("stale");
  });
  it("celebrating overrides active/idle in live mode", () => {
    expect(deriveDmdState("live", idle, true, NOW)).toBe("celebrate");
  });
  it("active droid in live mode animates its glyph, overriding cooling", () => {
    const activeButRecent = { ...active, last_action_at: new Date(NOW - 60_000).toISOString() };
    expect(deriveDmdState("live", activeButRecent, false, NOW)).toBe("active");
  });
  it("replay mode renders the replayed droid states, not stale", () => {
    expect(deriveDmdState("replay", active, false, NOW)).toBe("active");
  });
  it("recently-acted idle droid cools in live mode", () => {
    expect(deriveDmdState("live", recentlyIdle, false, NOW)).toBe("cooling");
  });
  it("recently-acted idle droid cools in replay mode against the replayed clock", () => {
    expect(deriveDmdState("replay", recentlyIdle, false, NOW)).toBe("cooling");
  });
  it("idle droid with no last_action_at is plain idle, not cooling", () => {
    expect(deriveDmdState("live", idle, false, NOW)).toBe("idle");
  });
  it("cooling does not apply in stale or idle board modes", () => {
    expect(deriveDmdState("stale", recentlyIdle, false, NOW)).toBe("stale");
    expect(deriveDmdState("idle", recentlyIdle, false, NOW)).toBe("idle");
  });
  it(`falls back to idle exactly at the ${COOLING_MIN}-minute boundary and past it`, () => {
    const atBoundary = {
      droid: "r5",
      state: "idle",
      last_action_at: new Date(NOW - COOLING_MIN * 60_000).toISOString(),
    } as const;
    const justPast = {
      droid: "r5",
      state: "idle",
      last_action_at: new Date(NOW - (COOLING_MIN * 60_000 + 1000)).toISOString(),
    } as const;
    const justUnder = {
      droid: "r5",
      state: "idle",
      last_action_at: new Date(NOW - (COOLING_MIN * 60_000 - 1000)).toISOString(),
    } as const;
    expect(deriveDmdState("live", atBoundary, false, NOW)).toBe("cooling"); // inclusive
    expect(deriveDmdState("live", justPast, false, NOW)).toBe("idle");
    expect(deriveDmdState("live", justUnder, false, NOW)).toBe("cooling");
  });
});

describe("cooling frame brightness", () => {
  it("cooling reads brighter than plain standby for every droid", () => {
    const droids = ["hk-47", "2-1b", "tt-8l", "ev-9d9", "r5", "copilot"] as const;
    for (const d of droids) {
      const standby = dmdFrame(d, "idle", 1500);
      const cooling = dmdFrame(d, "cooling", 1500);
      const sum = (f: Uint8Array) => f.reduce((a, b) => a + b, 0);
      expect(Math.max(...cooling)).toBeGreaterThan(Math.max(...standby));
      expect(sum(cooling)).toBeGreaterThan(sum(standby));
      expect(cooling).not.toEqual(dmdFrame(d, "active", 1500));
    }
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
        renderedAtMs: NOW,
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
          renderedAtMs: NOW,
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
        renderedAtMs: NOW,
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
