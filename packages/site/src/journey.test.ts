import type { Chain, PublicEventKind } from "@observatory/core";
import { describe, expect, it } from "vitest";
import { chainStage, createTween, STAGES, type Stage, stageOf } from "./journey.js";

describe("stageOf", () => {
  // Complete mapping table over every PublicEventKind — this test breaks
  // (by TypeScript's exhaustiveness check in STAGE_BY_KIND, and by this
  // list going stale) the moment a new kind is added without deciding its
  // stage.
  const expected: Record<PublicEventKind, Stage | null> = {
    pr_opened: "opened",
    review_requested: "review",
    review_started: "review",
    review_posted: "review",
    check_run: "ci",
    coder_completed: "rework",
    copilot_session_started: "rework",
    copilot_session_ended: "rework",
    merge_decision: "decision",
    merge_queued: "decision",
    merge_executed: "merged",
    pr_merged: "merged",
    pr_closed: "merged",
    issue_dispatched: null,
  };

  for (const [kind, stage] of Object.entries(expected) as [PublicEventKind, Stage | null][]) {
    it(`${kind} -> ${stage ?? "null"}`, () => {
      expect(stageOf(kind)).toBe(stage);
    });
  }

  it("STAGES is the full ordered stage list", () => {
    expect(STAGES).toEqual(["opened", "review", "ci", "rework", "decision", "merged"]);
  });
});

describe("chainStage", () => {
  function chain(hops: Chain["hops"]): Chain {
    return { pr: 1, hops, updated_at: "2026-01-01T00:00:00Z", active: true, complete: false };
  }

  it("uses the last hop with a non-null stage", () => {
    const c = chain([
      { at: "t0", droid: "system", kind: "pr_opened", label: "opened" },
      { at: "t1", droid: "hk-47", kind: "review_started", label: "review started" },
      { at: "t2", droid: "system", kind: "issue_dispatched", label: "n/a" },
    ]);
    expect(chainStage(c)).toEqual({ stage: "review", droid: "hk-47" });
  });

  it("a later hop can move the stage backward (rework after decision)", () => {
    const c = chain([
      { at: "t0", droid: "tt-8l", kind: "merge_decision", label: "decision" },
      { at: "t1", droid: "copilot", kind: "copilot_session_started", label: "session started" },
    ]);
    expect(chainStage(c)).toEqual({ stage: "rework", droid: "copilot" });
  });

  it("falls back to opened/system for a chain with no staged hop", () => {
    expect(chainStage(chain([]))).toEqual({ stage: "opened", droid: "system" });
  });

  it("a reopened chain's journey dot returns to OPENED (reopen rides pr_opened's stage for free)", () => {
    // HSC#173: reopen is classified as kind "pr_opened" (see reduce.ts), so
    // it inherits pr_opened's "opened" stage via STAGE_BY_KIND with no
    // change needed here — this test pins that inheritance.
    const c = chain([
      { at: "t0", droid: "system", kind: "pr_opened", label: "PR #42 opened" },
      { at: "t1", droid: "hk-47", kind: "review_started", label: "review started" },
      { at: "t2", droid: "system", kind: "pr_merged", label: "PR #42 merged" },
      { at: "t3", droid: "system", kind: "pr_opened", label: "PR #42 reopened" },
    ]);
    expect(chainStage(c)).toEqual({ stage: "opened", droid: "system" });
  });
});

describe("createTween", () => {
  it("is deterministic: identical inputs produce identical outputs", () => {
    const a = createTween({ durationMs: 600 });
    a.setTarget(3, 1000);
    const b = createTween({ durationMs: 600 });
    b.setTarget(3, 1000);
    for (const t of [1000, 1100, 1300, 1600, 2000]) {
      expect(a.positionAt(t)).toBe(b.positionAt(t));
    }
  });

  it("eases forward from 0 to a target over the duration", () => {
    const tw = createTween({ durationMs: 600 });
    tw.setTarget(2, 1000);
    expect(tw.positionAt(999)).toBe(0); // before start: holds the prior position
    expect(tw.positionAt(1000)).toBe(0); // at start: exactly the prior position
    expect(tw.positionAt(1600)).toBe(2); // at/after duration: exactly the target
    const mid = tw.positionAt(1300);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(2);
  });

  it("eases backward symmetrically", () => {
    const tw = createTween({ durationMs: 600 });
    tw.setTarget(5, 0);
    tw.positionAt(600); // settle at 5
    tw.setTarget(1, 1000);
    expect(tw.positionAt(1000)).toBe(5);
    expect(tw.positionAt(1600)).toBe(1);
    const mid = tw.positionAt(1300);
    expect(mid).toBeLessThan(5);
    expect(mid).toBeGreaterThan(1);
  });

  it("a mid-tween retarget starts from the current interpolated position, not the old target", () => {
    const tw = createTween({ durationMs: 600 });
    tw.setTarget(2, 0); // 0 -> 2 over [0, 600]
    const midway = tw.positionAt(300); // partway through the first tween
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(2);

    tw.setTarget(4, 300); // retarget mid-flight at t=300
    // Immediately after retargeting, position should equal wherever the
    // first tween had gotten to — not jump back to 0 and not stay at 2.
    expect(tw.positionAt(300)).toBeCloseTo(midway, 10);
    expect(tw.positionAt(900)).toBe(4); // and it still reaches the new target
  });
});
