import type { Chain, PublicEvent } from "@observatory/core";
import { describe, expect, it } from "vitest";
import { buildLiveLanes, buildReplayLane } from "./journey-lanes.js";

function chain(pr: number, hops: Chain["hops"], updatedAt: string): Chain {
  return { pr, hops, updated_at: updatedAt, active: true, complete: false };
}

function event(overrides: Partial<PublicEvent> & Pick<PublicEvent, "id" | "kind">): PublicEvent {
  return {
    at: "2026-01-01T00:00:00Z",
    droid: "system",
    summary: "event",
    ...overrides,
  } as PublicEvent;
}

describe("buildLiveLanes", () => {
  it("builds fresh (non-dimmed) lanes from chain hops", () => {
    const chains = [
      chain(
        42,
        [
          { at: "t0", droid: "system", kind: "pr_opened", label: "PR opened" },
          { at: "t1", droid: "hk-47", kind: "review_started", label: "review started" },
        ],
        "2026-01-01T00:01:00Z",
      ),
    ];
    const { lanes, states } = buildLiveLanes(chains);
    expect(lanes).toEqual([
      { pr: 42, latest: "review started", droid: "hk-47", canvasKey: "pr-42" },
    ]);
    expect(states[0]?.dimmed).toBe(false);
    expect(states[0]?.key).toBe("pr-42");
  });

  it("caps at LIVE_LANE_CAP (4), newest-first", () => {
    const chains = [1, 2, 3, 4, 5].map((n) =>
      chain(
        n,
        [{ at: "t0", droid: "system", kind: "pr_opened", label: "opened" }],
        `2026-01-0${n}T00:00:00Z`,
      ),
    );
    const { lanes } = buildLiveLanes(chains);
    expect(lanes.length).toBe(4);
    expect(lanes[0]?.pr).toBe(5);
  });
});

describe("buildReplayLane", () => {
  it("backward-scans for the last event carrying a pr when the newest event has none", () => {
    const feed: PublicEvent[] = [
      event({ id: "1", kind: "pr_opened", pr: 7, summary: "PR #7 opened" }),
      event({ id: "2", kind: "review_started", pr: 7, droid: "hk-47", summary: "review started" }),
      // Newest event is an issue dispatch with no .pr — must not fabricate PR #0.
      event({ id: "3", kind: "issue_dispatched", issue: 99, summary: "issue #99 dispatched" }),
    ];
    const built = buildReplayLane(feed);
    expect(built).not.toBeNull();
    expect(built?.lane.pr).toBe(7);
    expect(built?.lane.canvasKey).toBe("replay-7");
    // latest still reflects the newest event's own summary, independent of
    // which event supplied the pr.
    expect(built?.lane.latest).toBe("issue #99 dispatched");
    expect(built?.state.dimmed).toBe(false);
  });

  it("returns null (suppress the lane) when no event in the feed carries a pr yet", () => {
    const feed: PublicEvent[] = [
      event({ id: "1", kind: "issue_dispatched", issue: 5, summary: "issue #5 dispatched" }),
      event({ id: "2", kind: "issue_dispatched", issue: 6, summary: "issue #6 dispatched" }),
    ];
    expect(buildReplayLane(feed)).toBeNull();
  });

  it("returns null for an empty feed", () => {
    expect(buildReplayLane([])).toBeNull();
  });

  it("derives stage/droid from the last hop with a non-null stage, independent of the pr backward-scan", () => {
    const feed: PublicEvent[] = [
      event({ id: "1", kind: "pr_opened", pr: 3, summary: "PR #3 opened" }),
      event({ id: "2", kind: "merge_decision", pr: 3, droid: "tt-8l", summary: "merge decision" }),
      event({ id: "3", kind: "issue_dispatched", issue: 1, summary: "issue #1 dispatched" }),
    ];
    const built = buildReplayLane(feed);
    expect(built).not.toBeNull();
    expect(built?.state.stageIndex).toBe(4); // "decision"
    expect(built?.state.droid).toBe("tt-8l");
  });
});
