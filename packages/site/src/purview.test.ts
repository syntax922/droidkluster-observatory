import type { Chain, PublicEvent } from "@observatory/core";
import { describe, expect, it } from "vitest";
import { derivePurview, emptyPurview } from "./purview.js";

const T0 = Date.parse("2026-07-28T12:00:00Z");
const iso = (minAgo: number) => new Date(T0 - minAgo * 60_000).toISOString();

function chain(pr: number, hops: Array<[string, string, string]>, complete = false): Chain {
  return {
    pr,
    hops: hops.map(
      ([at, droid, kind]) => ({ at, droid, kind, label: lbl(kind, pr) }) as Chain["hops"][number],
    ),
    updated_at: hops[hops.length - 1]?.[0] ?? iso(0),
    active: true,
    complete,
  };
}
// Labels mirror the reducer's real formats — tt-8l's rule reads them.
function lbl(kind: string, pr: number): string {
  if (kind === "review_posted") return `review APPROVED · PR #${pr}`;
  return `${kind} · PR #${pr}`;
}
function ev(
  kind: "issue_dispatched" | "coder_completed",
  issue: number,
  minAgo: number,
): PublicEvent {
  return {
    id: `e-${kind}-${issue}-${minAgo}`,
    at: iso(minAgo),
    droid: "r5",
    kind,
    issue,
    summary: `x #${issue}`,
  };
}

describe("hk-47 reviews in flight", () => {
  it("collects started-not-posted reviews, newest first", () => {
    const p = derivePurview(
      [
        chain(101, [[iso(5), "hk-47", "review_started"]]),
        chain(102, [[iso(2), "hk-47", "review_started"]]),
        chain(103, [
          [iso(8), "hk-47", "review_started"],
          [iso(6), "hk-47", "review_posted"],
        ]),
      ],
      [],
      T0,
    );
    expect(p["hk-47"].prs).toEqual([102, 101]);
    expect(p["hk-47"].domainActive).toBe(true);
    expect(p["hk-47"].secondary).toBe(1); // one posted within window (outbox)
  });
  it("windows out stale starts", () => {
    const p = derivePurview([chain(101, [[iso(45), "hk-47", "review_started"]])], [], T0);
    expect(p["hk-47"].prs).toEqual([]);
    expect(p["hk-47"].domainActive).toBe(false);
  });
  it("re-started after posted counts as in flight again", () => {
    const p = derivePurview(
      [
        chain(101, [
          [iso(9), "hk-47", "review_started"],
          [iso(7), "hk-47", "review_posted"],
          [iso(3), "hk-47", "review_started"],
        ]),
      ],
      [],
      T0,
    );
    expect(p["hk-47"].prs).toEqual([101]);
  });
});

describe("2-1b CI churn", () => {
  it("recent check_run on incomplete chain is in CI", () => {
    const p = derivePurview([chain(201, [[iso(4), "system", "check_run"]])], [], T0);
    expect(p["2-1b"].prs).toEqual([201]);
    expect(p["2-1b"].domainActive).toBe(true);
  });
  it("check_run older than 10 min is not in CI", () => {
    const p = derivePurview([chain(201, [[iso(14), "system", "check_run"]])], [], T0);
    expect(p["2-1b"].prs).toEqual([]);
  });
  it("complete chain never counts as in CI", () => {
    const p = derivePurview([chain(201, [[iso(2), "system", "check_run"]], true)], [], T0);
    expect(p["2-1b"].prs).toEqual([]);
  });
});

describe("tt-8l merge queue", () => {
  it("APPROVED without merge is queued", () => {
    const p = derivePurview([chain(301, [[iso(6), "hk-47", "review_posted"]])], [], T0);
    expect(p["tt-8l"].prs).toEqual([301]);
  });
  it("merged PRs leave the queue", () => {
    const p = derivePurview(
      [
        chain(
          301,
          [
            [iso(6), "hk-47", "review_posted"],
            [iso(2), "system", "pr_merged"],
          ],
          true,
        ),
      ],
      [],
      T0,
    );
    expect(p["tt-8l"].prs).toEqual([]);
  });
  it("a CHANGES_REQUESTED verdict is not queued", () => {
    const c = chain(301, [[iso(6), "hk-47", "review_posted"]]);
    const hop = c.hops[0];
    if (hop) hop.label = "review CHANGES_REQUESTED · PR #301";
    const p = derivePurview([c], [], T0);
    expect(p["tt-8l"].prs).toEqual([]);
  });
  it("a re-review revokes tt-8l's queued claim", () => {
    const p = derivePurview(
      [
        chain(301, [
          [iso(20), "hk-47", "review_posted"],
          [iso(5), "hk-47", "review_started"],
        ]),
      ],
      [],
      T0,
    );
    expect(p["hk-47"].prs).toEqual([301]);
    expect(p["tt-8l"].prs).toEqual([]);
  });
});

describe("r5 dispatch pairs (feed)", () => {
  it("unmatched dispatches count; matched ones settle; prs stays empty", () => {
    const p = derivePurview(
      [],
      [ev("issue_dispatched", 71, 8), ev("issue_dispatched", 72, 6), ev("coder_completed", 71, 3)],
      T0,
    );
    expect(p.r5.prs).toEqual([]);
    expect(p.r5.secondary).toBe(1);
    expect(p.r5.domainActive).toBe(true);
  });
  it("windowed-out dispatches don't count", () => {
    const p = derivePurview([], [ev("issue_dispatched", 71, 40)], T0);
    expect(p.r5.secondary).toBe(0);
    expect(p.r5.domainActive).toBe(false);
  });
});

describe("shape", () => {
  it("emptyPurview covers every droid, all inert", () => {
    const p = emptyPurview();
    for (const d of ["hk-47", "2-1b", "tt-8l", "ev-9d9", "r5", "copilot"] as const) {
      expect(p[d]).toEqual({ prs: [], domainActive: false, secondary: 0 });
    }
  });
  it("ev-9d9 and copilot never derive anything", () => {
    const p = derivePurview([chain(1, [[iso(1), "ev-9d9", "check_run"]])], [], T0);
    expect(p["ev-9d9"].prs).toEqual([]);
    expect(p.copilot.prs).toEqual([]);
  });
});
