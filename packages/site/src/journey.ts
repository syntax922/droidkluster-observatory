import type { Chain, DroidId, PublicEventKind } from "@observatory/core";

// The pipeline's spatial stages, in travel order. A chain's hops map onto
// this axis so the journey map can show "where is the PR on its path" —
// the same story the story rail tells serially, read spatially instead.
export type Stage = "opened" | "review" | "ci" | "rework" | "decision" | "merged";
export const STAGES: readonly Stage[] = ["opened", "review", "ci", "rework", "decision", "merged"];

// Every PublicEventKind maps to exactly one stage or to null (not
// chain-staged — issue_dispatched precedes PR existence entirely, so it has
// no place on a per-PR journey). Kept as an exhaustive Record so adding a
// new PublicEventKind is a compile error here until this mapping is updated.
const STAGE_BY_KIND: Record<PublicEventKind, Stage | null> = {
  pr_opened: "opened",
  review_requested: "review",
  review_started: "review",
  review_posted: "review",
  check_run: "ci",
  coder_completed: "rework",
  copilot_session_started: "rework",
  copilot_session_ended: "rework",
  merge_decision: "decision",
  pr_merged: "merged",
  pr_closed: "merged",
  issue_dispatched: null,
};

export function stageOf(kind: PublicEventKind): Stage | null {
  return STAGE_BY_KIND[kind];
}

// Derives a chain's current position from its own hop history: the LAST hop
// with a non-null stage wins (a later hop can move backward, e.g. a rework
// stage after a decision stage would be unusual but the rule is still "last
// staged hop wins", not "furthest stage reached"). The hop's own droid
// drives the glow color — that's who's "holding" the PR right now.
export function chainStage(chain: Chain): { stage: Stage; droid: DroidId | "system" } {
  for (let i = chain.hops.length - 1; i >= 0; i--) {
    const hop = chain.hops[i];
    if (!hop) continue;
    const stage = stageOf(hop.kind);
    if (stage) return { stage, droid: hop.droid };
  }
  // No staged hop at all (e.g. an empty chain) — treat as freshly opened,
  // attributed to no droid in particular.
  return { stage: "opened", droid: "system" };
}

export interface Tween {
  /** Retarget the tween toward `stageIndex`, starting from wherever the
   * tween's current interpolated position is at `atMs` (not from the old
   * target) — a mid-flight retarget continues smoothly rather than jumping. */
  setTarget(stageIndex: number, atMs: number): void;
  /** The tween's fractional position at `tMs`, eased between the position it
   * held when setTarget was last called and the target it was given. */
  positionAt(tMs: number): number;
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export function createTween(opts?: { durationMs?: number }): Tween {
  const duration = opts?.durationMs ?? 600;
  let fromPos = 0;
  let toPos = 0;
  let startMs = 0;

  function positionAt(tMs: number): number {
    if (duration <= 0) return toPos;
    const elapsed = tMs - startMs;
    if (elapsed <= 0) return fromPos;
    if (elapsed >= duration) return toPos;
    return fromPos + (toPos - fromPos) * easeInOutQuad(elapsed / duration);
  }

  function setTarget(stageIndex: number, atMs: number): void {
    fromPos = positionAt(atMs);
    toPos = stageIndex;
    startMs = atMs;
  }

  return { setTarget, positionAt };
}
