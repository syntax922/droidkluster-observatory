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
