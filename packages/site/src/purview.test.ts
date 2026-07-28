import type { Chain, PublicEvent } from "@observatory/core";
import { describe, expect, it } from "vitest";
import { derivePurview, emptyPurview } from "./purview.js";

const T0 = Date.parse("2026-07-28T12:00:00Z");
const iso = (minAgo: number) => new Date(T0 - minAgo * 60_000).toISOString();

function chain(
  pr: number,
  hops: Array<[string, string, string, string?]>,
  complete = false,
): Chain {
  return {
    pr,
    hops: hops.map(
      ([at, droid, kind, label]) =>
        ({ at, droid, kind, label: label ?? lbl(kind, pr) }) as Chain["hops"][number],
    ),
    updated_at: hops[hops.length - 1]?.[0] ?? iso(0),
    active: true,
    complete,
  };
}
// chainL: same builder — named for callers that pass reducer-faithful per-hop
// labels via the 4th tuple element (e.g. ciHop below) instead of relying on lbl().
const chainL = chain;
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

function ciHop(
  at: string,
  kind: "red" | "success" | "skipped",
  pr: number,
): [string, string, string, string] {
  const word = kind === "red" ? "CI red" : kind === "success" ? "CI success" : "CI skipped";
  // Mirror reduce.ts's real attribution: red check_runs come from 2-1b; other
  // check_run outcomes stay "system". The derivation doesn't read droid, but
  // fixtures should still be reducer-faithful, same discipline as the labels.
  const droid = kind === "red" ? "2-1b" : "system";
  return [at, droid, "check_run", `${word} (unit) · PR #${pr}`];
}

describe("2-1b amiss (unresolved CI red)", () => {
  it("counts a red with no later success", () => {
    const p = derivePurview([chainL(501, [ciHop(iso(5), "red", 501)])], [], T0);
    expect(p["2-1b"].secondary).toBe(1);
  });
  it("a later success resolves it", () => {
    const p = derivePurview(
      [chainL(501, [ciHop(iso(6), "red", 501), ciHop(iso(3), "success", 501)])],
      [],
      T0,
    );
    expect(p["2-1b"].secondary).toBe(0);
  });
  it("a red followed only by skips stays unresolved", () => {
    const p = derivePurview(
      [chainL(501, [ciHop(iso(6), "red", 501), ciHop(iso(3), "skipped", 501)])],
      [],
      T0,
    );
    expect(p["2-1b"].secondary).toBe(1);
  });
  it("aged-out reds self-clear", () => {
    const p = derivePurview([chainL(501, [ciHop(iso(14), "red", 501)])], [], T0);
    expect(p["2-1b"].secondary).toBe(0); // outside CI_RECENT_MS (10 min)
  });
  it("multiple red chains count independently", () => {
    const p = derivePurview(
      [chainL(501, [ciHop(iso(4), "red", 501)]), chainL(502, [ciHop(iso(2), "red", 502)])],
      [],
      T0,
    );
    expect(p["2-1b"].secondary).toBe(2);
  });
  it("a success-then-red is unresolved (order matters)", () => {
    const p = derivePurview(
      [chainL(501, [ciHop(iso(6), "success", 501), ciHop(iso(3), "red", 501)])],
      [],
      T0,
    );
    expect(p["2-1b"].secondary).toBe(1);
  });
  it("a complete (merged/closed) chain doesn't fibrillate, even with an in-window red", () => {
    const p = derivePurview([chainL(501, [ciHop(iso(5), "red", 501)], true)], [], T0);
    expect(p["2-1b"].secondary).toBe(0);
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
