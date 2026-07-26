import type { ReplayBundle } from "@observatory/core";
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
});
