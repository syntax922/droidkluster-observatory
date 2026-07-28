import type { Chain, ChainHop, DroidId, PublicEvent } from "@observatory/core";

export const WINDOW_MS = 30 * 60_000;
export const CI_RECENT_MS = 10 * 60_000;

export interface DroidPurview {
  prs: number[]; // PR numbers in this droid's purview, newest-activity first
  domainActive: boolean;
  secondary: number; // per-droid meaning: hk-47 = reviews POSTED in window (outbox);
  // r5 = in-flight dispatches (its prs is always []); others 0
}
export type Purview = Record<DroidId, DroidPurview>;

const DROIDS: DroidId[] = ["hk-47", "2-1b", "tt-8l", "ev-9d9", "r5", "copilot"];

export function emptyPurview(): Purview {
  const result = {} as Purview;
  for (const d of DROIDS) result[d] = { prs: [], domainActive: false, secondary: 0 };
  return result;
}

function within(at: string, nowMs: number, windowMs: number): boolean {
  const t = Date.parse(at);
  return Number.isFinite(t) && nowMs - t <= windowMs && t <= nowMs + 60_000; // small future-skew tolerance
}

// Latest hop of a kind; hops are already time-ordered by the reducer, walk from the end.
function lastHop(c: Chain, kind: ChainHop["kind"]): { hop: ChainHop; index: number } | undefined {
  for (let i = c.hops.length - 1; i >= 0; i--) {
    const hop = c.hops[i];
    if (hop && hop.kind === kind) return { hop, index: i };
  }
  return undefined;
}

// Sorts [pr, at] pairs by at descending (newest-activity first) and dedupes by pr,
// keeping the newest occurrence.
function toOrderedPrs(entries: Array<[number, string]>): number[] {
  const sorted = [...entries].sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
  const seen = new Set<number>();
  const result: number[] = [];
  for (const [pr] of sorted) {
    if (seen.has(pr)) continue;
    seen.add(pr);
    result.push(pr);
  }
  return result;
}

export function derivePurview(
  chains: readonly Chain[],
  feedEvents: readonly PublicEvent[],
  nowMs: number,
): Purview {
  const p = emptyPurview();

  const hk47Entries: Array<[number, string]> = [];
  let hk47Secondary = 0;
  const twoOneBEntries: Array<[number, string]> = [];
  const tt8lEntries: Array<[number, string]> = [];

  for (const c of chains) {
    // hk-47: latest review_started with no later review_posted, within WINDOW.
    const started = lastHop(c, "review_started");
    if (started && within(started.hop.at, nowMs, WINDOW_MS)) {
      const hasLaterPosted = c.hops
        .slice(started.index + 1)
        .some((h) => h.kind === "review_posted");
      if (!hasLaterPosted) hk47Entries.push([c.pr, started.hop.at]);
    }
    for (const h of c.hops) {
      if (h.kind === "review_posted" && within(h.at, nowMs, WINDOW_MS)) hk47Secondary++;
    }

    // 2-1b: incomplete chains with a recent check_run.
    if (!c.complete) {
      const checkRun = lastHop(c, "check_run");
      if (checkRun && within(checkRun.hop.at, nowMs, CI_RECENT_MS)) {
        twoOneBEntries.push([c.pr, checkRun.hop.at]);
      }
    }

    // tt-8l: latest review_posted is an APPROVED verdict with no later merge, within WINDOW.
    const posted = lastHop(c, "review_posted");
    if (
      posted &&
      within(posted.hop.at, nowMs, WINDOW_MS) &&
      posted.hop.label.includes("APPROVED")
    ) {
      const hasLaterTerminal = c.hops
        .slice(posted.index + 1)
        .some((h) => h.kind === "pr_merged" || h.kind === "merge_decision");
      if (!hasLaterTerminal) tt8lEntries.push([c.pr, posted.hop.at]);
    }
  }

  const hk47Prs = toOrderedPrs(hk47Entries);
  p["hk-47"] = { prs: hk47Prs, domainActive: hk47Prs.length > 0, secondary: hk47Secondary };

  const twoOneBPrs = toOrderedPrs(twoOneBEntries);
  p["2-1b"] = { prs: twoOneBPrs, domainActive: twoOneBPrs.length > 0, secondary: 0 };

  const tt8lPrs = toOrderedPrs(tt8lEntries);
  p["tt-8l"] = { prs: tt8lPrs, domainActive: tt8lPrs.length > 0, secondary: 0 };

  // r5: prs always empty; secondary = unmatched issue_dispatched feed events in window.
  let r5Secondary = 0;
  for (const e of feedEvents) {
    if (e.kind !== "issue_dispatched" || e.issue === undefined) continue;
    if (!within(e.at, nowMs, WINDOW_MS)) continue;
    const matched = feedEvents.some(
      (o) => o.kind === "coder_completed" && o.issue === e.issue && o.at > e.at,
    );
    if (!matched) r5Secondary++;
  }
  p.r5 = { prs: [], domainActive: r5Secondary > 0, secondary: r5Secondary };

  // ev-9d9 and copilot: always inert (already set by emptyPurview).

  return p;
}
