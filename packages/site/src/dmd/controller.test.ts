import { describe, expect, it, vi } from "vitest";
import { emptyPurview } from "../purview.js";
import type { BoardMode } from "./controller.js";
import { COOLING_MIN, deriveDmdState, startDmd } from "./controller.js";
import { dmdFrame } from "./glyphs.js";

const NOW = Date.parse("2026-07-27T12:00:00Z");

const P0 = { prs: [], domainActive: false, secondary: 0 };
const PD = { prs: [7, 8], domainActive: true, secondary: 0 };

describe("deriveDmdState", () => {
  const idle = { droid: "r5", state: "idle" } as const;
  const active = { droid: "r5", state: "active", task: "dispatching issue #1" } as const;
  const recentlyIdle = {
    droid: "r5",
    state: "idle",
    last_action_at: new Date(NOW - 2 * 60_000).toISOString(),
  } as const;
  it("stale mode overrides everything, including an active droid", () => {
    expect(deriveDmdState("stale", active, false, NOW, P0)).toBe("stale");
  });
  it("celebrating overrides active/idle in live mode", () => {
    expect(deriveDmdState("live", idle, true, NOW, P0)).toBe("celebrate");
  });
  it("active droid in live mode animates its glyph, overriding cooling", () => {
    const activeButRecent = { ...active, last_action_at: new Date(NOW - 60_000).toISOString() };
    expect(deriveDmdState("live", activeButRecent, false, NOW, P0)).toBe("active");
  });
  it("replay mode renders the replayed droid states, not stale", () => {
    expect(deriveDmdState("replay", active, false, NOW, P0)).toBe("active");
  });
  it("recently-acted idle droid cools in live mode", () => {
    expect(deriveDmdState("live", recentlyIdle, false, NOW, P0)).toBe("cooling");
  });
  it("recently-acted idle droid cools in replay mode against the replayed clock", () => {
    expect(deriveDmdState("replay", recentlyIdle, false, NOW, P0)).toBe("cooling");
  });
  it("idle droid with no last_action_at is plain idle, not cooling", () => {
    expect(deriveDmdState("live", idle, false, NOW, P0)).toBe("idle");
  });
  it("cooling does not apply in stale or idle board modes", () => {
    expect(deriveDmdState("stale", recentlyIdle, false, NOW, P0)).toBe("stale");
    expect(deriveDmdState("idle", recentlyIdle, false, NOW, P0)).toBe("idle");
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
    expect(deriveDmdState("live", atBoundary, false, NOW, P0)).toBe("cooling"); // inclusive
    expect(deriveDmdState("live", justPast, false, NOW, P0)).toBe("idle");
    expect(deriveDmdState("live", justUnder, false, NOW, P0)).toBe("cooling");
  });
  it("domain outranks cooling but not active", () => {
    const recent = new Date(NOW - 60_000).toISOString();
    expect(
      deriveDmdState(
        "live",
        { droid: "2-1b", state: "idle", last_action_at: recent },
        false,
        NOW,
        PD,
      ),
    ).toBe("domain");
    expect(deriveDmdState("live", { droid: "2-1b", state: "active" }, false, NOW, PD)).toBe(
      "active",
    );
  });
  it("stale and celebrate outrank domain", () => {
    expect(deriveDmdState("stale", { droid: "2-1b", state: "idle" }, false, NOW, PD)).toBe("stale");
    expect(deriveDmdState("live", { droid: "2-1b", state: "idle" }, true, NOW, PD)).toBe(
      "celebrate",
    );
  });
  it("no purview -> cooling/idle unchanged", () => {
    const recent = new Date(NOW - 60_000).toISOString();
    expect(
      deriveDmdState(
        "live",
        { droid: "2-1b", state: "idle", last_action_at: recent },
        false,
        NOW,
        P0,
      ),
    ).toBe("cooling");
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
        purview: emptyPurview(),
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
          purview: emptyPurview(),
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
        purview: emptyPurview(),
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

  it("paintAll wires the flap board: it overlays live purview PRs, then clears when BoardMode goes idle with the same purview object still attached", () => {
    // Reproduces the leak the reviewer flagged: a BoardView carrying stale
    // purview data into "idle" mode must not keep the flap board paging old
    // PR numbers under an idle glyph — the flap layer has no dimming cue of
    // its own to signal that "idle" means "ignore this data".
    const purviewWithPrs = {
      ...emptyPurview(),
      r5: { prs: [42], domainActive: false, secondary: 0 },
    };
    let mode: BoardMode = "live";
    let t = 0;
    const paint = vi.fn();
    const root = document.createElement("div");
    root.innerHTML = '<canvas data-dmd="r5" width="192" height="96"></canvas>';
    let queued: (() => void) | null = null;
    const raf = vi.fn((cb: () => void) => {
      queued = cb;
    });
    startDmd({
      root,
      reducedMotion: false,
      raf,
      paint,
      now: () => t,
      getBoard: () => ({
        mode,
        droids: [{ droid: "r5", state: "idle" }],
        celebrating: false,
        renderedAtMs: NOW,
        purview: purviewWithPrs,
      }),
    });

    t = 1000;
    (queued as (() => void) | null)?.();
    const liveFrame = paint.mock.calls.at(-1)?.[1] as Uint8Array;
    // deriveDmdState: no last_action_at and domainActive false -> plain "idle"
    // glyph is the base; the flap board's "#42" page must show up on top of it.
    expect(Array.from(liveFrame)).not.toEqual(Array.from(dmdFrame("r5", "idle", t)));

    mode = "idle";
    t = 2000;
    (queued as (() => void) | null)?.();
    const idleFrame = paint.mock.calls.at(-1)?.[1] as Uint8Array;
    // Same purview object, same [42] PR still sitting in it — but BoardMode
    // "idle" must force the flap board to clear, so the painted frame is
    // exactly the plain idle glyph with no flap-band contribution at all.
    expect(Array.from(idleFrame)).toEqual(Array.from(dmdFrame("r5", "idle", t)));
  });
});
