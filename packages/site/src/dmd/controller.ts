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
}

export function startDmd(opts: StartDmdOpts): () => void {
  const now = opts.now ?? (() => performance.now());
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const reduced =
    opts.reducedMotion ??
    (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  let stopped = false;
  let lastPaint = 0;
  let lastKey = "";

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
      paintFrame(el, dmdFrame(droid, state, t), ACCENTS[droid]);
    }
    return parts.join("|");
  }

  if (reduced) {
    // Static: repaint only when the derived state-set changes, checked on a slow interval.
    lastKey = paintAll(0);
    const timer = setInterval(() => {
      if (stopped) return;
      const board = opts.getBoard();
      const key = canvases()
        .map(({ droid }) => {
          const s = board.droids.find((d) => d.droid === droid) ?? {
            droid,
            state: "idle" as const,
          };
          return `${droid}:${deriveDmdState(board.mode, s, board.celebrating)}`;
        })
        .join("|");
      if (key !== lastKey) lastKey = paintAll(0);
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
