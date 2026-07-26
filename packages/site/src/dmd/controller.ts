import type { DroidId, DroidStatus } from "@observatory/core";
import { type DmdState, dmdFrame } from "./glyphs.js";
import { paintFrame } from "./painter.js";
import { ACCENTS } from "./palette.js";

export type BoardMode = "live" | "stale" | "replay" | "idle";
export interface BoardView {
  mode: BoardMode;
  droids: DroidStatus[];
  celebrating: boolean;
}

export function deriveDmdState(
  mode: BoardMode,
  droid: DroidStatus,
  celebrating: boolean,
): DmdState {
  if (mode === "stale") return "stale";
  if (celebrating) return "celebrate";
  return droid.state === "active" ? "active" : "idle";
}

const TICK_MS = 66; // <=15fps

export interface StartDmdOpts {
  root: HTMLElement;
  getBoard: () => BoardView;
  now?: () => number;
  raf?: (cb: () => void) => void;
  reducedMotion?: boolean;
  // Test-only seam: inject a paint spy without touching the real canvas
  // painter. Production callers never set this — it defaults to the real
  // paintFrame — so the public startDmd contract is otherwise unchanged.
  paint?: typeof paintFrame;
}

export function startDmd(opts: StartDmdOpts): () => void {
  const now = opts.now ?? (() => performance.now());
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const paint = opts.paint ?? paintFrame;
  const reduced =
    opts.reducedMotion ??
    (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  let stopped = false;
  let lastPaint = 0;

  function canvases(): Array<{ el: HTMLCanvasElement; droid: DroidId }> {
    // Array.from (not spread) — NodeListOf isn't Iterable under this
    // project's DOM lib config, but it is array-like.
    return Array.from(opts.root.querySelectorAll<HTMLCanvasElement>("canvas[data-dmd]"), (el) => ({
      el,
      droid: el.dataset.dmd as DroidId,
    }));
  }

  function paintAll(t: number): string {
    const board = opts.getBoard();
    const parts: string[] = [];
    for (const { el, droid } of canvases()) {
      const status = board.droids.find((d) => d.droid === droid) ?? {
        droid,
        state: "idle" as const,
      };
      const state = deriveDmdState(board.mode, status, board.celebrating);
      parts.push(`${droid}:${state}`);
      paint(el, dmdFrame(droid, state, t), ACCENTS[droid]);
    }
    return parts.join("|");
  }

  if (reduced) {
    // Static: repaint unconditionally on a slow interval, AND once immediately
    // at start. A state-key diff here is unsafe: renderStations() replaces
    // station canvases wholesale on every poll, so a derived-state match
    // against the OLD canvas would skip painting the fresh (blank) one that
    // replaced it — the DMD would go permanently blank after any re-render
    // whose state-key happened to match the prior key.
    paintAll(0);
    const timer = setInterval(() => {
      if (stopped) return;
      paintAll(0);
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
      paintAll(t);
    }
    raf(loop);
  }
  raf(loop);
  return () => {
    stopped = true;
  };
}
