import type { Chain } from "@observatory/core";
import { describe, expect, it } from "vitest";
import { createCelebrationTracker } from "./celebrate.js";

function chainWithHop(at: string, kind: Chain["hops"][number]["kind"] = "pr_merged"): Chain[] {
  return [
    {
      pr: 1,
      hops: [{ at, droid: "system", kind, label: "x" }],
      updated_at: at,
      active: true,
      complete: kind === "pr_merged",
    },
  ];
}

describe("createCelebrationTracker", () => {
  it("celebrates for 3s of display time on first observation of a merge hop, then stops", () => {
    let t = 0;
    const tracker = createCelebrationTracker(() => t);

    t = 1_000;
    expect(tracker.observe(chainWithHop("2026-07-26T10:00:00Z"))).toBe(true);

    // Still within the 3s celebration window, even with no new hop observed.
    t = 1_000 + 2_999;
    expect(tracker.observe([])).toBe(true);

    // Past the window.
    t = 1_000 + 3_000;
    expect(tracker.observe([])).toBe(false);
  });

  it("re-observing the same hop repeatedly does not re-trigger after expiry", () => {
    let t = 0;
    const tracker = createCelebrationTracker(() => t);
    const chains = chainWithHop("2026-07-26T10:00:00Z");

    t = 0;
    expect(tracker.observe(chains)).toBe(true);

    t = 5_000; // well past expiry
    expect(tracker.observe(chains)).toBe(false);

    t = 5_100;
    expect(tracker.observe(chains)).toBe(false);
  });

  it("a newer pr_merged hop re-triggers the celebration window", () => {
    let t = 0;
    const tracker = createCelebrationTracker(() => t);

    t = 0;
    expect(tracker.observe(chainWithHop("2026-07-26T10:00:00Z"))).toBe(true);

    t = 5_000; // expired
    expect(tracker.observe(chainWithHop("2026-07-26T10:00:00Z"))).toBe(false);

    t = 5_100;
    expect(tracker.observe(chainWithHop("2026-07-26T10:05:00Z"))).toBe(true);

    t = 5_100 + 2_999;
    expect(tracker.observe([])).toBe(true);
    t = 5_100 + 3_000;
    expect(tracker.observe([])).toBe(false);
  });

  it("chains without a pr_merged hop never celebrate", () => {
    const t = 0;
    const tracker = createCelebrationTracker(() => t);

    expect(tracker.observe(chainWithHop("2026-07-26T10:00:00Z", "pr_opened"))).toBe(false);
    expect(tracker.observe(chainWithHop("2026-07-26T10:05:00Z", "review_started"))).toBe(false);
    expect(tracker.observe([])).toBe(false);
  });
});

describe("elapsedMs", () => {
  it("is null before any celebration", () => {
    const t = 0;
    const tracker = createCelebrationTracker(() => t);
    expect(tracker.elapsedMs()).toBeNull();
  });

  it("is 0 at the moment a celebration starts and grows with the tracker's own clock", () => {
    let t = 1_000;
    const tracker = createCelebrationTracker(() => t);
    tracker.observe(chainWithHop("2026-07-26T10:00:00Z"));
    expect(tracker.elapsedMs()).toBe(0);

    t = 1_000 + 1_500;
    expect(tracker.elapsedMs()).toBe(1_500);
  });

  it("is null again once the window expires", () => {
    let t = 0;
    const tracker = createCelebrationTracker(() => t);
    tracker.observe(chainWithHop("2026-07-26T10:00:00Z"));
    t = 3_000; // exactly at expiry — observe()'s `now() < celebrateUntil` is exclusive
    expect(tracker.elapsedMs()).toBeNull();
  });

  it("a merge arriving mid-celebration extends the window but does NOT reset the start — elapsedMs keeps growing from the original start, not from 0", () => {
    let t = 0;
    const tracker = createCelebrationTracker(() => t);
    tracker.observe(chainWithHop("2026-07-26T10:00:00Z"));

    t = 1_000; // still well within the first 3s window
    tracker.observe(chainWithHop("2026-07-26T10:00:01Z")); // a newer merge lands
    // Had the start reset here, elapsedMs would be 0. It must instead read
    // as "1000ms into the still-ongoing span" — the rocket keeps climbing,
    // it doesn't snap back to the pad for every merge in a burst.
    expect(tracker.elapsedMs()).toBe(1_000);
  });

  it("a merge arriving AFTER expiry starts a fresh span at elapsedMs=0", () => {
    let t = 0;
    const tracker = createCelebrationTracker(() => t);
    tracker.observe(chainWithHop("2026-07-26T10:00:00Z"));

    t = 5_000; // past expiry
    tracker.observe(chainWithHop("2026-07-26T10:05:00Z"));
    expect(tracker.elapsedMs()).toBe(0);
  });
});
