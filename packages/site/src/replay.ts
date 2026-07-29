import {
  type CurrentSnapshot,
  DEFAULT_CODER_LOGIN,
  emptyFleetState,
  type PublicEvent,
  type ReplayBundle,
  reduce,
  toSnapshot,
} from "@observatory/core";
import { spanLabel } from "./time.js";

export function replayLabel(bundle: ReplayBundle): string {
  const first = bundle.events[0];
  const last = bundle.events[bundle.events.length - 1];
  const span = first && last ? spanLabel(first.at, last.at) : "0s";
  return `REPLAY — PR #${bundle.pr} · ${bundle.captured_on} · ${span} of history`;
}

export interface ReplayOpts {
  onFrame: (snap: CurrentSnapshot, feed: PublicEvent[], label: string) => void;
  onDone: () => void;
}

// Per-event dwell: how long an event stays "current" before the next one
// fires. This replaces real-time compression — a fleet event stream's actual
// cadence (seconds to hours between hops) has no relationship to how long a
// person needs to read what happened, so pacing is keyed to comprehension
// (a beat per event, longer for prose, longer still for a PR landing) rather
// than to the wall-clock gap between the original events.
const BASE_DWELL_MS = 2400;
const EXCERPT_DWELL_MS = 4200;
const MERGE_DWELL_MS = 3000;
const MAX_PLAYBACK_MS = 180_000;
const MIN_DWELL_MS = 700;

// Comprehension-aware extension (2026-07-27 pairing): a beat whose first
// event represents an actual state change (anything but batched CI
// green/skipped noise) gets extra dwell on top of its kind-specific base —
// readers need longer to register "something happened" than to skim a CI
// tick. Applies BEFORE scheduleDwells' MAX_PLAYBACK_MS scale-down, same as
// every other raw dwell.
const NOTABLE_EXTENSION_MS = 1200;

// Mirrors chains.ts's static-timeline batching threshold: a run of this
// many-or-more consecutive system check_run events is CI noise, not a
// narrative beat, at the pacing layer too.
const BATCH_MIN_RUN = 3;

// Mirrors chains.ts's GAP_THRESHOLD_MS: a run only holds together while
// consecutive events stay within this real-time gap. A quiet stretch this
// long inside what would otherwise be one batch is a pause worth its own
// beat, not noise to compress away.
const BATCH_GAP_THRESHOLD_MS = 10 * 60 * 1000;

function baseDwellFor(event: PublicEvent): number {
  if (event.excerpt) return EXCERPT_DWELL_MS;
  if (event.kind === "pr_merged" || event.kind === "pr_closed") return MERGE_DWELL_MS;
  return BASE_DWELL_MS;
}

// A beat is "notable" — worth the extra NOTABLE_EXTENSION_MS — unless it's a
// check_run whose summary doesn't signal a red build. That covers every
// other event kind unconditionally (a review, a merge, a dispatch — all
// state changes worth pausing on) plus a check_run that specifically went
// red (2-1B activating is itself a state change). A batched run of
// green/skipped check_run events is, by construction, never red (a red
// check_run breaks batching — see buildBeats), so batched beats always stay
// at base dwell.
function isNotableBeat(firstEvent: PublicEvent): boolean {
  if (firstEvent.kind !== "check_run") return true;
  return firstEvent.summary.startsWith("CI red");
}

// The `event.droid === "system"` check is what actually keeps red
// check_runs out of batches (a red check_run's summary alone is never
// consulted here) — reduce.ts's classify() attributes a failing check_run
// to droid "2-1b" and every other conclusion to droid "system" (see
// reduce.ts's check_run branch). If that attribution ever changes, a red
// check_run could start passing this predicate, silently entering a batch
// and losing both its own notable-dwell extension and isNotableBeat's
// "red breaks batching" assumption above.
function isBatchableCheckRun(event: PublicEvent): boolean {
  return event.droid === "system" && event.kind === "check_run";
}

// A single event, or a run of >= BATCH_MIN_RUN consecutive batchable
// check_run events collapsed into one display beat. Every underlying event
// still gets reduced (state/feed fidelity is untouched) — only how many
// onFrame calls and how much dwell the run consumes changes.
interface Beat {
  events: PublicEvent[];
  rawDwell: number;
}

// Same run-detection as chains.ts's groupHopUnits, but over PublicEvents
// (the pacing layer sees the bundle's raw events, not chain hops) and
// producing a dwell alongside each beat: a batch spends exactly one base
// dwell in total, not one per underlying event.
function buildBeats(events: PublicEvent[]): Beat[] {
  const beats: Beat[] = [];
  let i = 0;
  while (i < events.length) {
    const event = events[i];
    if (event && isBatchableCheckRun(event)) {
      let j = i + 1;
      while (j < events.length) {
        const next = events[j];
        const prev = events[j - 1];
        if (!next || !isBatchableCheckRun(next)) break;
        if (prev && Date.parse(next.at) - Date.parse(prev.at) > BATCH_GAP_THRESHOLD_MS) break;
        j++;
      }
      const run = events.slice(i, j);
      if (run.length >= BATCH_MIN_RUN) {
        const first = run[0] as PublicEvent;
        beats.push({
          events: run,
          rawDwell: BASE_DWELL_MS + (isNotableBeat(first) ? NOTABLE_EXTENSION_MS : 0),
        });
        i = j;
        continue;
      }
    }
    if (event) {
      beats.push({
        events: [event],
        rawDwell: baseDwellFor(event) + (isNotableBeat(event) ? NOTABLE_EXTENSION_MS : 0),
      });
    }
    i++;
  }
  return beats;
}

// Scales dwells down so a long bundle still finishes inside MAX_PLAYBACK_MS,
// but never shrinks an excerpt's reading time below EXCERPT_DWELL_MS — a
// wall of review prose flashed for 700ms would be worse than a replay that
// runs a little long. Non-excerpt dwells absorb the whole cut, floored at
// MIN_DWELL_MS so even a very long bundle keeps individual beats legible.
// Operates on beats rather than raw events so a batch's single dwell scales
// (or floors) exactly like any other non-excerpt beat.
function scheduleDwells(beats: Beat[]): number[] {
  const raw = beats.map((b) => b.rawDwell);
  const total = raw.reduce((sum, d) => sum + d, 0);
  if (total <= MAX_PLAYBACK_MS) return raw;

  const hasExcerpt = (b: Beat): boolean =>
    b.events.length === 1 && (b.events[0] as PublicEvent).excerpt !== undefined;

  let excerptSum = 0;
  let nonExcerptSum = 0;
  beats.forEach((b, i) => {
    const dwell = raw[i] as number;
    if (hasExcerpt(b)) excerptSum += dwell;
    else nonExcerptSum += dwell;
  });
  const budget = Math.max(0, MAX_PLAYBACK_MS - excerptSum);
  const scale = nonExcerptSum > 0 ? budget / nonExcerptSum : 1;

  return beats.map((b, i) => {
    const dwell = raw[i] as number;
    return hasExcerpt(b) ? dwell : Math.max(MIN_DWELL_MS, Math.round(dwell * scale));
  });
}

// The replay round-trip is self-contained (we synthesize subjects and
// immediately reduce them), so the token never needs to be a real repo
// name — and the browser bundle stays private-name-free.
const REPLAY_REPO = "project";

// Replays run each bundle event through the SAME reducer the projector uses,
// so the board renders replayed state with zero replay-specific render code.
export class ReplayPlayer {
  private bundle: ReplayBundle;
  private opts: ReplayOpts;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private stopped = false;

  constructor(bundle: ReplayBundle, opts: ReplayOpts) {
    this.bundle = bundle;
    this.opts = opts;
  }

  start(): void {
    const state = emptyFleetState();
    const feed: PublicEvent[] = [];
    const label = replayLabel(this.bundle);
    const beats = buildBeats(this.bundle.events);
    const dwells = scheduleDwells(beats);

    const fire = (i: number): void => {
      if (this.stopped) return;
      const beat = beats[i];
      if (!beat) return;
      let lastEvent: PublicEvent | undefined;
      // Every underlying event in the beat runs through the reducer and
      // joins the feed — a batch changes how many times onFrame paints, not
      // what state/feed accumulate. Only the final event's frame is shown.
      for (const event of beat.events) {
        reduce(
          state,
          {
            kind: "event",
            id: `replay-${event.id}`,
            subject: syntheticSubject(event),
            ts: event.at,
            payload: syntheticPayload(event),
          },
          { repo: REPLAY_REPO },
        );
        feed.push(event);
        lastEvent = event;
      }
      if (!lastEvent) return;
      this.opts.onFrame(toSnapshot(state, new Date(lastEvent.at)), feed, label);
      if (this.stopped) return; // onFrame may call stop() synchronously mid-loop
      if (i === beats.length - 1) {
        this.opts.onDone();
        return;
      }
      const dwell = dwells[i] ?? BASE_DWELL_MS;
      this.timers.push(setTimeout(() => fire(i + 1), dwell));
    };

    fire(0);
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  // @internal
  pendingTimerCount(): number {
    return this.timers.length;
  }
}

// Rebuild the minimal canon shape each PublicEvent came from, so the shared
// reducer accepts it. Only fields the reducer reads are synthesized.
function syntheticSubject(e: PublicEvent): string {
  switch (e.kind) {
    case "pr_opened":
      // pr_opened is reused for the reopen variant (see reduce.ts's
      // classify()) — sniff the summary the same way syntheticPayload does,
      // since PublicEvent carries no separate `reopen` flag on the wire.
      return e.summary.endsWith("reopened")
        ? `gh.event.${REPLAY_REPO}.pr.reopened.${e.pr}`
        : `gh.event.${REPLAY_REPO}.pr.opened.${e.pr}`;
    case "review_requested":
      return `gh.event.${REPLAY_REPO}.pr.review_requested.${e.pr}`;
    case "review_started":
      return `gh.event.${REPLAY_REPO}.pr.review_started.${e.pr}`;
    case "rework_started":
      return `gh.event.${REPLAY_REPO}.pr.assigned.${e.pr}`;
    case "review_posted":
      return `gh.event.${REPLAY_REPO}.pull_request_review.submitted.${e.pr}`;
    case "check_run":
      return `gh.event.${REPLAY_REPO}.check_run.completed.${e.pr}`;
    case "copilot_session_started":
      return `gh.event.${REPLAY_REPO}.copilot_session.started.${e.pr}`;
    case "copilot_session_ended":
      return `gh.event.${REPLAY_REPO}.copilot_session.ended.${e.pr}`;
    case "merge_decision":
      return `${REPLAY_REPO}.event.merge_decision.reached.${e.pr}`;
    case "merge_queued":
      return `${REPLAY_REPO}.event.merge_queue.enqueue.${e.pr}`;
    case "merge_executed":
      return `${REPLAY_REPO}.event.merge.executed.${e.pr}`;
    case "pr_merged":
    case "pr_closed":
      return `gh.event.${REPLAY_REPO}.pr.closed.${e.pr}`;
    case "issue_dispatched":
      return `gh.event.${REPLAY_REPO}.issue.dispatched.${e.issue ?? 0}`;
    case "coder_completed":
      // brand — unchanged (droidkluster is the public brand, not the private repo token)
      return `droidkluster.event.coder.completed.replay-${e.id}`;
  }
}

function syntheticPayload(e: PublicEvent): Record<string, unknown> {
  const verdictMatch = /review (\w+)/.exec(e.summary);
  const pr = e.pr ?? 0;
  switch (e.kind) {
    case "pr_opened":
      return e.summary.endsWith("reopened")
        ? {
            action: "reopened",
            pull_request: { number: pr },
            repository: { full_name: "replay/replay" },
          }
        : { action: "opened", pull_request: { number: pr } };
    case "review_requested":
      return { action: "review_requested", pull_request: { number: pr } };
    case "review_started":
      return { action: "review_started", pull_request: { number: pr } };
    case "rework_started":
      // Round-trips through the same gate the reducer applies: only an
      // assignment to the coder login is a rework start.
      return {
        action: "assigned",
        assignee: { login: DEFAULT_CODER_LOGIN },
        pull_request: { number: pr },
      };
    case "review_posted":
      return {
        action: "submitted",
        review: {
          state: verdictMatch?.[1]?.toLowerCase() ?? "commented",
          ...(e.excerpt ? { body: e.excerpt } : {}),
        },
        pull_request: { number: pr },
      };
    case "check_run": {
      const conclusion = e.summary.startsWith("CI red")
        ? "failure"
        : (/^CI (\w+)/.exec(e.summary)?.[1] ?? "success");
      const name = /\(([^)]+)\)/.exec(e.summary)?.[1] ?? "check";
      return {
        action: "completed",
        check_run: {
          name,
          conclusion,
          pull_requests: [{ number: pr }],
        },
      };
    }
    case "copilot_session_started":
      return { action: "started", pull_request: { number: pr } };
    case "copilot_session_ended":
      return { action: "ended", pull_request: { number: pr } };
    case "merge_decision": {
      // The reducer reads the decider's own lowercase vocabulary, so map the
      // rendered verdict back to it for a faithful round-trip.
      const rendered = /decision: (\w+)/.exec(e.summary)?.[1] ?? "DECIDED";
      const verdict =
        rendered === "APPROVED"
          ? "approve"
          : rendered === "CHANGES_REQUESTED"
            ? "request_changes"
            : rendered === "COMMENTED"
              ? "comment"
              : rendered;
      return { pr, verdict };
    }
    case "merge_queued":
      return { pr };
    case "merge_executed":
      return { pr, outcome: /merge (\w+) ·/.exec(e.summary)?.[1] ?? "executed" };
    case "pr_merged":
      return { action: "closed", pull_request: { number: pr, merged: true } };
    case "pr_closed":
      return { action: "closed", pull_request: { number: pr, merged: false } };
    case "issue_dispatched":
      return {
        issue_number: e.issue,
        command_id: `replay-${e.id}`,
      };
    case "coder_completed": {
      const status = /coder (\w+)/.exec(e.summary)?.[1] ?? "completed";
      const opened = /opened from issue #(\d+)/.exec(e.summary);
      return opened
        ? {
            kind: "issue",
            pr_number: e.pr,
            issue_number: Number(opened[1]),
            status: "opened",
            exit_code: 0,
          }
        : {
            kind: e.pr !== undefined ? "rework" : "issue",
            ...(e.pr !== undefined ? { pr_number: e.pr } : {}),
            ...(e.issue !== undefined ? { issue_number: e.issue } : {}),
            status,
            exit_code: 0,
          };
    }
  }
}
