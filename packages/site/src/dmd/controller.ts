import type { DroidId, DroidStatus } from "@observatory/core";
import type { DroidPurview, Purview } from "../purview.js";
import { createFlapBoard, type FlapBoard } from "./flapboard.js";
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
  // Ms elapsed in the celebration tracker's own real-time clock (see
  // celebrate.ts's elapsedMs()) as of this render, or null/undefined when
  // not celebrating. Deliberately NOT a timestamp to diff against
  // renderedAtMs — renderedAtMs is real time in live mode but a replayed
  // historical time in replay mode, while the tracker always runs on real
  // display-clock time in both; this field is pre-computed in the tracker's
  // own domain so no cross-clock arithmetic happens here. Optional so
  // BoardView literals that never celebrate don't need to carry it. Used
  // only to anchor tt-8l's blast-off climb to the celebration's real start
  // — see paintAll's celebrateElapsedMs.
  celebrateElapsedAtRenderMs?: number | null;
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

  // Anchors tt-8l's blast-off climb to the celebration's real start instead
  // of the free-running paint clock. main.ts always constructs a fresh
  // BoardView object on each render, so a reference change here means "a new
  // render happened" — that's the moment we (re)anchor viewSeenAtT to the
  // current paint-clock tick. Between renders (the common case — polls are
  // ~20s apart, celebration windows are 3s), celebrateElapsedMs keeps
  // growing purely from paint-clock deltas, no fresh Date.now() reads.
  let lastView: BoardView | null = null;
  let viewSeenAtT = 0;

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
    if (view !== lastView) {
      lastView = view;
      viewSeenAtT = t;
    }
    // How far into the current celebration span we are, expressed in the
    // paint clock's own units: a fixed base (how much of the span had
    // already elapsed, per the tracker's own real-time clock, as of this
    // render — normally ~0) plus how many paint ticks have passed since we
    // first painted this exact view. Only meaningful while celebrating;
    // unused (and left undefined) otherwise so non-celebrating glyphs never
    // see it.
    const celebrateBaseMs = Math.max(0, view.celebrateElapsedAtRenderMs ?? 0);
    const celebrateElapsedMs = celebrateBaseMs + Math.max(0, t - viewSeenAtT);
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
      // Cleared on "stale"/"celebrate" (those states own the whole frame) AND
      // on BoardMode "idle" — deriveDmdState never returns "domain" outside
      // live/replay, but idle purview data can still be sitting in view.purview
      // (e.g. a carried-forward BoardView that forgot to clear it), and the
      // flap layer has no dimming cue of its own to signal staleness. Belt
      // and suspenders: no BoardView-construction site should be able to leak
      // stale flap-board PRs onto an idle glyph.
      flapBoard.setPrs(
        view.mode === "idle" || state === "stale" || state === "celebrate" ? [] : purview.prs,
        t,
      );
      const frame = dmdFrame(
        droid,
        state,
        t,
        { primary: purview.prs.length, secondary: purview.secondary },
        state === "celebrate" ? celebrateElapsedMs : undefined,
      );
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
