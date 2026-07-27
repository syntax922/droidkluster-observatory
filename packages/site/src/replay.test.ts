import type { CurrentSnapshot, PublicEvent, ReplayBundle } from "@observatory/core";
import { describe, expect, it, vi } from "vitest";
import { ReplayPlayer, replayLabel } from "./replay.js";

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

describe("replayLabel", () => {
  it("labels with pr, captured date, and the humanized span of history", () => {
    expect(replayLabel(bundle)).toBe("REPLAY — PR #1607 · 2026-07-23 · 30m of history");
  });
});

describe("ReplayPlayer", () => {
  it("emits one frame per event, in order, spaced by each event's dwell", () => {
    vi.useFakeTimers();
    const frames: string[] = [];
    const onDone = vi.fn();
    const player = new ReplayPlayer(bundle, {
      onFrame: (_snap, feed) => frames.push(feed[feed.length - 1]?.summary ?? ""),
      onDone,
    });
    player.start();
    expect(frames).toHaveLength(1); // first event fires immediately
    vi.advanceTimersByTime(1599); // just short of the base dwell (1600ms)
    expect(frames).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(frames).toHaveLength(2);
    expect(frames[1]).toContain("APPROVED");
    expect(onDone).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("an event carrying an excerpt holds the screen for the longer excerpt dwell", () => {
    vi.useFakeTimers();
    const excerptBundle: ReplayBundle = {
      id: "excerpt-bundle",
      title: "t",
      captured_on: "2026-07-25",
      pr: 99,
      events: [
        {
          id: "a",
          at: "2026-07-25T00:00:00Z",
          droid: "system",
          kind: "pr_opened",
          pr: 99,
          summary: "PR #99 opened",
        },
        {
          id: "b",
          at: "2026-07-25T00:01:00Z",
          droid: "hk-47",
          kind: "review_posted",
          pr: 99,
          summary: "review APPROVED · PR #99",
          excerpt: "Looks solid, nice work — clean separation and good test coverage throughout.",
        },
        {
          id: "c",
          at: "2026-07-25T00:02:00Z",
          droid: "system",
          kind: "pr_merged",
          pr: 99,
          summary: "PR #99 merged",
        },
      ],
    };
    const frames: string[] = [];
    const player = new ReplayPlayer(excerptBundle, {
      onFrame: (_snap, feed) => frames.push(feed[feed.length - 1]?.summary ?? ""),
      onDone: () => {},
    });
    player.start();
    expect(frames).toHaveLength(1); // pr_opened shown immediately
    vi.advanceTimersByTime(1600); // pr_opened's base dwell elapses
    expect(frames).toHaveLength(2); // the excerpt-bearing review is now current
    vi.advanceTimersByTime(4199); // just short of the excerpt dwell
    expect(frames).toHaveLength(2); // still holding — not the 1600/3000ms a non-excerpt event would use
    vi.advanceTimersByTime(1); // completes the 4200ms excerpt dwell
    expect(frames).toHaveLength(3);
    vi.useRealTimers();
  });

  it("stop() cancels pending frames", () => {
    vi.useFakeTimers();
    const frames: unknown[] = [];
    const player = new ReplayPlayer(bundle, {
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
      onFrame: (_snap, feed) => {
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

  it("scales non-excerpt dwells to the playback cap, flooring at 700ms, while excerpt dwells never shrink", () => {
    vi.useFakeTimers();
    const total = 260;
    const excerptEvery = 26; // 10 excerpt-bearing events out of 260
    const events: PublicEvent[] = Array.from({ length: total }, (_, i) => ({
      id: `s${i}`,
      at: new Date(Date.parse("2026-07-25T00:00:00Z") + i * 60_000).toISOString(),
      droid: i % 2 === 0 ? "system" : "hk-47",
      kind: "check_run",
      pr: 900,
      summary: "CI passed (build) · PR #900",
      ...(i % excerptEvery === 0
        ? { excerpt: "A longer review comment that should not be rushed off screen." }
        : {}),
    }));
    const bigBundle: ReplayBundle = {
      id: "big",
      title: "big bundle",
      captured_on: "2026-07-25",
      pr: 900,
      events,
    };

    const timestamps: number[] = [];
    const onDone = vi.fn();
    const player = new ReplayPlayer(bigBundle, {
      onFrame: () => timestamps.push(Date.now()),
      onDone,
    });
    const start = Date.now();
    player.start();
    vi.runAllTimers();

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(timestamps).toHaveLength(total);

    const gaps = timestamps.slice(1).map((t, i) => t - (timestamps[i] ?? t));
    const distinctGaps = new Set(gaps);
    for (const g of distinctGaps) expect([700, 4200]).toContain(g);
    expect(distinctGaps.has(700)).toBe(true); // the floor actually engaged

    const excerptCount = events.filter((e) => e.excerpt).length;
    const totalDuration = (timestamps[timestamps.length - 1] ?? start) - start;
    // Loose bound: the non-excerpt portion is capped near MAX_PLAYBACK_MS
    // (180s), and excerpt dwells are layered on top unscaled.
    expect(totalDuration).toBeLessThanOrEqual(180_000 + excerptCount * 4200);
    vi.useRealTimers();
  });

  it("an all-excerpt bundle never divides by zero (nonExcerptSum===0 guard) and leaves every dwell unscaled", () => {
    vi.useFakeTimers();
    const total = 60;
    const events: PublicEvent[] = Array.from({ length: total }, (_, i) => ({
      id: `x${i}`,
      at: new Date(Date.parse("2026-07-25T00:00:00Z") + i * 60_000).toISOString(),
      droid: "hk-47",
      kind: "review_posted",
      pr: 500,
      summary: "review APPROVED · PR #500",
      excerpt: "Every one of these carries prose, so nothing here should ever get scaled down.",
    }));
    const allExcerptBundle: ReplayBundle = {
      id: "all-excerpt",
      title: "all excerpt",
      captured_on: "2026-07-25",
      pr: 500,
      events,
    };

    const timestamps: number[] = [];
    const onDone = vi.fn();
    const player = new ReplayPlayer(allExcerptBundle, {
      onFrame: () => timestamps.push(Date.now()),
      onDone,
    });
    const start = Date.now();
    expect(() => player.start()).not.toThrow();
    vi.runAllTimers();

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(timestamps).toHaveLength(total);
    const gaps = timestamps.slice(1).map((t, i) => t - (timestamps[i] ?? t));
    expect(gaps.every((g) => g === 4200)).toBe(true); // unscaled excerpt dwell throughout

    // 59 excerpt gaps of 4200ms = 247,800ms, well past the 180s cap.
    // Excerpt dwells never shrink, so an all-excerpt bundle legitimately
    // runs long — that's the guard's intended behavior, not a bug.
    const totalDuration = (timestamps[timestamps.length - 1] ?? start) - start;
    expect(totalDuration).toBeGreaterThan(180_000);
    vi.useRealTimers();
  });

  it("round-trip all 10 PublicEventKinds preserves summary fidelity via reduce", () => {
    vi.useFakeTimers();
    // Use exact reducer-generated summaries from classify() in reduce.ts
    const allEvents: PublicEvent[] = [
      {
        id: "e1",
        at: "2026-07-25T00:00:00Z",
        droid: "system",
        kind: "pr_opened",
        pr: 42,
        summary: "PR #42 opened",
      },
      {
        id: "e2",
        at: "2026-07-25T00:01:00Z",
        droid: "system",
        kind: "review_requested",
        pr: 42,
        summary: "review requested · PR #42",
      },
      {
        id: "e3",
        at: "2026-07-25T00:02:00Z",
        droid: "hk-47",
        kind: "review_started",
        pr: 42,
        summary: "HK-47 review started · PR #42",
      },
      {
        id: "e4",
        at: "2026-07-25T00:03:00Z",
        droid: "hk-47",
        kind: "review_posted",
        pr: 42,
        summary: "review APPROVED · PR #42",
      },
      {
        id: "e5",
        at: "2026-07-25T00:04:00Z",
        droid: "2-1b",
        kind: "check_run",
        pr: 42,
        summary: "CI red (test-unit) · PR #42",
      },
      {
        id: "e6",
        at: "2026-07-25T00:05:00Z",
        droid: "system",
        kind: "check_run",
        pr: 42,
        summary: "CI cancelled (build) · PR #42",
      },
      {
        id: "e7",
        at: "2026-07-25T00:06:00Z",
        droid: "copilot",
        kind: "copilot_session_started",
        pr: 42,
        summary: "copilot session started · PR #42",
      },
      {
        id: "e8",
        at: "2026-07-25T00:07:00Z",
        droid: "copilot",
        kind: "copilot_session_ended",
        pr: 42,
        summary: "copilot session ended · PR #42",
      },
      {
        id: "e9",
        at: "2026-07-25T00:08:00Z",
        droid: "tt-8l",
        kind: "merge_decision",
        pr: 42,
        summary: "merge decision: APPROVED · PR #42",
      },
      {
        id: "e10",
        at: "2026-07-25T00:09:00Z",
        droid: "system",
        kind: "pr_merged",
        pr: 42,
        summary: "PR #42 merged",
      },
      {
        id: "k11",
        at: "2026-07-25T00:10:00Z",
        droid: "r5",
        kind: "issue_dispatched",
        issue: 128,
        summary: "issue #128 dispatched to coder",
      },
      {
        id: "k12",
        at: "2026-07-25T00:11:00Z",
        droid: "r5",
        kind: "coder_completed",
        pr: 42,
        summary: "coder reworked · PR #42",
      },
      {
        id: "k13",
        at: "2026-07-25T00:12:00Z",
        droid: "r5",
        kind: "coder_completed",
        pr: 130,
        issue: 128,
        summary: "PR #130 opened from issue #128",
      },
    ];

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
      onFrame: (snap: CurrentSnapshot, feed) => {
        snapshots.push(snap);
        feeds.push({ feed, snap });
      },
      onDone: () => {},
    });
    player.start();
    expect(snapshots).toHaveLength(1); // first event fires immediately
    // 12 base-dwell (1600ms) hops + 1 pr_merged hop (3000ms) between the 13
    // events = 20,600ms of dwell to walk through the whole chain.
    vi.advanceTimersByTime(21_000);
    expect(snapshots).toHaveLength(13);
    // Assert against chain hops (reducer output) for original 10 pr-bearing kinds
    const finalSnap = snapshots[snapshots.length - 1];
    expect(finalSnap).toBeDefined();
    const chain = finalSnap?.chains.find((c) => c.pr === 42);
    expect(chain?.hops).toBeTruthy();
    const hopLabels = chain?.hops?.map((h) => h.label) ?? [];
    // PR-bearing events create hops: e1-e10 + k12 coder_completed (k11 issue_dispatched does not)
    const prHopEvents = [
      ...allEvents.slice(0, 10),
      allEvents[11], // k12 (coder_completed with pr: 42)
    ].filter((e) => e !== undefined);
    expect(hopLabels).toEqual(prHopEvents.map((e) => e.summary));
    // Assert k13 (opened-from-issue) creates hop on PR #130 chain with correct label
    const chain130 = finalSnap?.chains.find((c) => c.pr === 130);
    expect(chain130?.hops).toBeTruthy();
    const hopLabels130 = chain130?.hops?.map((h) => h.label) ?? [];
    expect(hopLabels130).toContain("PR #130 opened from issue #128");
    // Verify issue_dispatched (k11) activated r5 droid before k12 idles it
    const snapshotWithK11 = snapshots.find((snap) => {
      const r5 = snap.droids.find((d) => d.droid === "r5");
      return r5?.task === "dispatching issue #128";
    });
    expect(snapshotWithK11).toBeDefined();
    // Assert final droid state captures last_action from k13 (final coder_completed event)
    // Note: last_action uses "coder {status} · {ref}" format, not the "opened from issue" summary
    const r5Droid = finalSnap?.droids.find((d) => d.droid === "r5");
    expect(r5Droid?.last_action).toBe("coder opened · PR #130");
    vi.useRealTimers();
  });

  it("a run of 3+ consecutive system check_run events collapses to one dwell/onFrame beat", () => {
    vi.useFakeTimers();
    const checkRun = (id: string, at: string): PublicEvent => ({
      id,
      at,
      droid: "system",
      kind: "check_run",
      pr: 42,
      summary: `CI skipped (${id}) · PR #42`,
    });
    const batchBundle: ReplayBundle = {
      id: "batch",
      title: "batch",
      captured_on: "2026-07-25",
      pr: 42,
      events: [
        {
          id: "a",
          at: "2026-07-25T00:00:00Z",
          droid: "system",
          kind: "pr_opened",
          pr: 42,
          summary: "PR #42 opened",
        },
        checkRun("c1", "2026-07-25T00:01:00Z"),
        checkRun("c2", "2026-07-25T00:02:00Z"),
        checkRun("c3", "2026-07-25T00:03:00Z"),
        {
          id: "z",
          at: "2026-07-25T00:04:00Z",
          droid: "hk-47",
          kind: "review_posted",
          pr: 42,
          summary: "review APPROVED · PR #42",
        },
      ],
    };
    const frameFeeds: PublicEvent[][] = [];
    const onDone = vi.fn();
    const player = new ReplayPlayer(batchBundle, {
      onFrame: (_snap, feed) => frameFeeds.push([...feed]),
      onDone,
    });
    player.start();
    // pr_opened fires immediately as its own beat.
    expect(frameFeeds).toHaveLength(1);
    // The 3-run of check_run events collapses to ONE beat: a single base
    // dwell (1600ms) advances the frame, not 3x1600ms.
    vi.advanceTimersByTime(1600);
    expect(frameFeeds).toHaveLength(2);
    // But all 3 underlying events were fed through the reducer and joined
    // the feed — state/round-trip fidelity is untouched by the batch.
    const batchFrame = frameFeeds[1];
    expect(batchFrame?.map((e) => e.id)).toEqual(["a", "c1", "c2", "c3"]);
    // Confirm it didn't take 2 more dwells to get here (i.e. it wasn't
    // still rendering per-event) — advancing only 1 more base dwell moves
    // on to the final review_posted beat.
    vi.advanceTimersByTime(1600);
    expect(frameFeeds).toHaveLength(3);
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("a run of exactly 2 consecutive system check_run events does not batch", () => {
    vi.useFakeTimers();
    const checkRun = (id: string, at: string): PublicEvent => ({
      id,
      at,
      droid: "system",
      kind: "check_run",
      pr: 42,
      summary: `CI skipped (${id}) · PR #42`,
    });
    const twoBundle: ReplayBundle = {
      id: "two",
      title: "two",
      captured_on: "2026-07-25",
      pr: 42,
      events: [checkRun("c1", "2026-07-25T00:00:00Z"), checkRun("c2", "2026-07-25T00:01:00Z")],
    };
    const frameFeeds: PublicEvent[][] = [];
    const onDone = vi.fn();
    const player = new ReplayPlayer(twoBundle, {
      onFrame: (_snap, feed) => frameFeeds.push([...feed]),
      onDone,
    });
    player.start();
    expect(frameFeeds).toHaveLength(1); // c1 fires immediately, unbatched
    vi.advanceTimersByTime(1600);
    expect(frameFeeds).toHaveLength(2); // c2 fires as its own beat
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("a check_run event attributed to 2-1B never batches, even amid a system run", () => {
    vi.useFakeTimers();
    const checkRun = (id: string, at: string): PublicEvent => ({
      id,
      at,
      droid: "system",
      kind: "check_run",
      pr: 42,
      summary: `CI skipped (${id}) · PR #42`,
    });
    const redCheckRun: PublicEvent = {
      id: "red",
      at: "2026-07-25T00:02:00Z",
      droid: "2-1b",
      kind: "check_run",
      pr: 42,
      summary: "CI red (test-unit) · PR #42",
    };
    const mixedBundle: ReplayBundle = {
      id: "mixed",
      title: "mixed",
      captured_on: "2026-07-25",
      pr: 42,
      events: [
        checkRun("c1", "2026-07-25T00:00:00Z"),
        checkRun("c2", "2026-07-25T00:01:00Z"),
        redCheckRun,
        checkRun("c3", "2026-07-25T00:03:00Z"),
        checkRun("c4", "2026-07-25T00:04:00Z"),
      ],
    };
    const frameFeeds: PublicEvent[][] = [];
    const player = new ReplayPlayer(mixedBundle, {
      onFrame: (_snap, feed) => frameFeeds.push([...feed]),
      onDone: () => {},
    });
    player.start();
    vi.runAllTimers();
    // The 2-1B hop splits the run into two runs of 2 (below threshold), so
    // all 5 events render as 5 separate beats/frames.
    expect(frameFeeds).toHaveLength(5);
    vi.useRealTimers();
  });
});
