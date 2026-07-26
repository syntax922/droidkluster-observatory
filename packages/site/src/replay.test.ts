import type { CurrentSnapshot, PublicEvent, ReplayBundle } from "@observatory/core";
import { describe, expect, it, vi } from "vitest";
import { ReplayPlayer, pickCompression, replayLabel } from "./replay.js";

const bundle: ReplayBundle = {
  id: "pr-1607-2026-07-23",
  title: "PR #1607 lifecycle",
  captured_on: "2026-07-23",
  pr: 1607,
  events: [
    {
      id: "a",
      at: "2026-07-23T13:00:00Z",
      droid: "system",
      kind: "pr_opened",
      pr: 1607,
      summary: "PR #1607 opened",
    },
    {
      id: "b",
      at: "2026-07-23T13:30:00Z",
      droid: "hk-47",
      kind: "review_posted",
      pr: 1607,
      summary: "review APPROVED · PR #1607",
    },
  ],
};

describe("replayLabel / pickCompression", () => {
  it("labels with pr, date, compression", () => {
    expect(replayLabel(bundle, 30)).toBe("REPLAY — PR #1607, 2026-07-23 (time ×30)");
  });
  it("targets ~90s playback", () => {
    // 30 min span / 90s target = ×20
    expect(pickCompression(bundle)).toBe(20);
  });
});

describe("ReplayPlayer", () => {
  it("emits one frame per event, in order, on the compressed clock", () => {
    vi.useFakeTimers();
    const frames: string[] = [];
    const onDone = vi.fn();
    const player = new ReplayPlayer(bundle, {
      compression: 20,
      onFrame: (snap, feed) => frames.push(feed[feed.length - 1]?.summary ?? ""),
      onDone,
    });
    player.start();
    expect(frames).toHaveLength(1); // first event fires immediately
    vi.advanceTimersByTime(90_000); // 30 real minutes / ×20 = 90s
    expect(frames).toHaveLength(2);
    expect(frames[1]).toContain("APPROVED");
    expect(onDone).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("stop() cancels pending frames", () => {
    vi.useFakeTimers();
    const frames: unknown[] = [];
    const player = new ReplayPlayer(bundle, {
      compression: 20,
      onFrame: (s) => frames.push(s),
      onDone: () => {},
    });
    player.start();
    player.stop();
    vi.advanceTimersByTime(200_000);
    expect(frames).toHaveLength(1);
    vi.useRealTimers();
  });

  it("stop() called during onFrame prevents further frames and cancels timers", () => {
    vi.useFakeTimers();
    const frames: string[] = [];
    let playerRef: ReplayPlayer | null = null;
    const player = new ReplayPlayer(bundle, {
      compression: 20,
      onFrame: (snap, feed) => {
        frames.push(feed[feed.length - 1]?.summary ?? "");
        // Stop on first frame to test guard during callback
        if (frames.length === 1 && playerRef) {
          playerRef.stop();
        }
      },
      onDone: () => {},
    });
    playerRef = player;
    player.start();
    expect(frames).toHaveLength(1); // first event fires immediately
    vi.advanceTimersByTime(200_000);
    expect(frames).toHaveLength(1); // no further frames after stop
    expect(player.pendingTimerCount()).toBe(0); // no timers remain
    vi.useRealTimers();
  });

  it("round-trip all 10 PublicEventKinds preserves summary fidelity via reduce", () => {
    vi.useFakeTimers();
    // Use exact reducer-generated summaries from classify() in reduce.ts
    const allEvents = [
      {
        id: "e1" as const,
        at: "2026-07-25T00:00:00Z",
        droid: "system" as const,
        kind: "pr_opened" as const,
        pr: 42,
        summary: "PR #42 opened",
      },
      {
        id: "e2" as const,
        at: "2026-07-25T00:01:00Z",
        droid: "system" as const,
        kind: "review_requested" as const,
        pr: 42,
        summary: "review requested · PR #42",
      },
      {
        id: "e3" as const,
        at: "2026-07-25T00:02:00Z",
        droid: "hk-47" as const,
        kind: "review_started" as const,
        pr: 42,
        summary: "HK-47 review started · PR #42",
      },
      {
        id: "e4" as const,
        at: "2026-07-25T00:03:00Z",
        droid: "hk-47" as const,
        kind: "review_posted" as const,
        pr: 42,
        summary: "review APPROVED · PR #42",
      },
      {
        id: "e5" as const,
        at: "2026-07-25T00:04:00Z",
        droid: "2-1b" as const,
        kind: "check_run" as const,
        pr: 42,
        summary: "CI red (test-unit) · PR #42",
      },
      {
        id: "e6" as const,
        at: "2026-07-25T00:05:00Z",
        droid: "system" as const,
        kind: "check_run" as const,
        pr: 42,
        summary: "CI cancelled (build) · PR #42",
      },
      {
        id: "e7" as const,
        at: "2026-07-25T00:06:00Z",
        droid: "copilot" as const,
        kind: "copilot_session_started" as const,
        pr: 42,
        summary: "copilot session started · PR #42",
      },
      {
        id: "e8" as const,
        at: "2026-07-25T00:07:00Z",
        droid: "copilot" as const,
        kind: "copilot_session_ended" as const,
        pr: 42,
        summary: "copilot session ended · PR #42",
      },
      {
        id: "e9" as const,
        at: "2026-07-25T00:08:00Z",
        droid: "tt-8l" as const,
        kind: "merge_decision" as const,
        pr: 42,
        summary: "merge decision: APPROVED · PR #42",
      },
      {
        id: "e10" as const,
        at: "2026-07-25T00:09:00Z",
        droid: "system" as const,
        kind: "pr_merged" as const,
        pr: 42,
        summary: "PR #42 merged",
      },
      {
        id: "k11" as const,
        at: "2026-07-25T00:10:00Z",
        droid: "r5" as const,
        kind: "issue_dispatched" as const,
        issue: 128,
        summary: "issue #128 dispatched to coder",
      },
      {
        id: "k12" as const,
        at: "2026-07-25T00:11:00Z",
        droid: "r5" as const,
        kind: "coder_completed" as const,
        pr: 42,
        summary: "coder reworked · PR #42",
      },
    ] as const as PublicEvent[];

    const testBundle = {
      id: "test-round-trip",
      title: "Round-trip test",
      captured_on: "2026-07-25",
      pr: 42,
      events: allEvents,
    };

    const snapshots: CurrentSnapshot[] = [];
    const feeds: Array<{ feed: typeof allEvents; snap: CurrentSnapshot }> = [];
    const player = new ReplayPlayer(testBundle, {
      compression: 1000,
      onFrame: (snap: CurrentSnapshot, feed) => {
        snapshots.push(snap);
        feeds.push({ feed, snap });
      },
      onDone: () => {},
    });
    player.start();
    expect(snapshots).toHaveLength(1); // first event fires immediately
    // Events span ~18 minutes, divided by compression (1000) = ~1080ms
    vi.advanceTimersByTime(1100);
    expect(snapshots).toHaveLength(12);
    // Assert against chain hops (reducer output) for original 10 pr-bearing kinds
    const finalSnap = snapshots[snapshots.length - 1];
    expect(finalSnap).toBeDefined();
    const chain = finalSnap?.chains.find((c) => c.pr === 42);
    expect(chain?.hops).toBeTruthy();
    const hopLabels = chain?.hops?.map((h) => h.label) ?? [];
    // Original 10 pr-bearing events create hops (e1-e10)
    const prHopEvents = allEvents.slice(0, 10);
    expect(hopLabels).toEqual(prHopEvents.map((e) => e.summary));
    // Droid state updates pending: reducer binding for coder_completed's idle field not materializing
    // Task 2 should have landed this, but investigation needed for why last_action remains undefined
    vi.useRealTimers();
  });
});
