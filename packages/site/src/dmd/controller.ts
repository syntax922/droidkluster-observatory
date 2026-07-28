import type { DroidId, DroidStatus } from "@observatory/core";
import type { DroidPurview, Purview } from "../purview.js";
import { type FlapBoard, createFlapBoard } from "./flapboard.js";
import { type DmdState, dmdFrame } from "./glyphs.js";
import { paintFrame } from "./painter.js";
import { ACCENTS } from "./palette.js";

export type BoardMode = "live" | "stale" | "replay" | "idle";
export interface BoardView {
  mode: BoardMode;
  droids: DroidStatus[];
  celebrating: boolean;
  // The wall-clock (or replay-equivalent) time this board was rendered at.
  // Used to derive the "cooling" afterglow window against each droid's
  // recorded last_action_at — deliberately NOT the raf animation clock
  // (dmdFrame's tMs), and NOT Date.now() read fresh here, so replay frames
  // cool relative to the replayed snapshot's own generated_at rather than
  // real wall time racing ahead of the story being replayed.
  renderedAtMs: number;
  purview: Purview;
}

// How long a droid's DMD keeps a visible afterglow after its last recorded
// action before fading back to its plain standby signature.
export const COOLING_MIN = 10;

export function deriveDmdState(
  mode: BoardMode,
  droid: DroidStatus,
  celebrating: boolean,
  nowMs: number,
  purview: DroidPurview,
): DmdState {
  if (mode === "stale") return "stale";
  if (celebrating) return "celebrate";
  if (droid.state === "active") return "active";
  if (mode === "live" || mode === "replay") {
    if (purview.domainActive) return "domain";
    if (droid.last_action_at !== undefined) {
      const ageMin = (nowMs - Date.parse(droid.last_action_at)) / 60_000;
      if (ageMin >= 0 && ageMin <= COOLING_MIN) return "cooling";
    }
  }
  return "idle";
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
  const boards = new Map<DroidId, FlapBoard>();

  function boardFor(droid: DroidId): FlapBoard {
    let board = boards.get(droid);
    if (!board) {
      board = createFlapBoard();
      boards.set(droid, board);
    }
    return board;
  }

  function canvases(): Array<{ el: HTMLCanvasElement; droid: DroidId }> {
    // Array.from (not spread) — NodeListOf isn't Iterable under this
    // project's DOM lib config, but it is array-like.
    return Array.from(opts.root.querySelectorAll<HTMLCanvasElement>("canvas[data-dmd]"), (el) => ({
      el,
      droid: el.dataset.dmd as DroidId,
    }));
  }

  function paintAll(t: number): string {
    const view = opts.getBoard();
    const parts: string[] = [];
    for (const { el, droid } of canvases()) {
      const status = view.droids.find((d) => d.droid === droid) ?? {
        droid,
        state: "idle" as const,
      };
      const purview = view.purview[droid];
      const state = deriveDmdState(view.mode, status, view.celebrating, view.renderedAtMs, purview);
      parts.push(`${droid}:${state}`);
      const flapBoard = boardFor(droid);
      flapBoard.setPrs(state === "stale" || state === "celebrate" ? [] : purview.prs, t);
      const frame = dmdFrame(droid, state, t, {
        primary: purview.prs.length,
        secondary: purview.secondary,
      });
      flapBoard.overlay(frame, t, reduced);
      paint(el, frame, ACCENTS[droid]);
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
