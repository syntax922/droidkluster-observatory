import {
  type CurrentSnapshot,
  type PublicEvent,
  type ReplayBundle,
  emptyFleetState,
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
const BASE_DWELL_MS = 1600;
const EXCERPT_DWELL_MS = 4200;
const MERGE_DWELL_MS = 3000;
const MAX_PLAYBACK_MS = 180_000;
const MIN_DWELL_MS = 700;

// Mirrors chains.ts's static-timeline batching threshold: a run of this
// many-or-more consecutive system check_run events is CI noise, not a
// narrative beat, at the pacing layer too.
const BATCH_MIN_RUN = 3;

function baseDwellFor(event: PublicEvent): number {
  if (event.excerpt) return EXCERPT_DWELL_MS;
  if (event.kind === "pr_merged" || event.kind === "pr_closed") return MERGE_DWELL_MS;
  return BASE_DWELL_MS;
}

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
        if (!next || !isBatchableCheckRun(next)) break;
        j++;
      }
      const run = events.slice(i, j);
      if (run.length >= BATCH_MIN_RUN) {
        beats.push({ events: run, rawDwell: BASE_DWELL_MS });
        i = j;
        continue;
      }
    }
    if (event) beats.push({ events: [event], rawDwell: baseDwellFor(event) });
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
        reduce(state, {
          kind: "event",
          id: `replay-${event.id}`,
          subject: syntheticSubject(event),
          ts: event.at,
          payload: syntheticPayload(event),
        });
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
      return `gh.event.dungeonadventures.pr.opened.${e.pr}`;
    case "review_requested":
      return `gh.event.dungeonadventures.pr.review_requested.${e.pr}`;
    case "review_started":
      return `gh.event.dungeonadventures.pr.review_started.${e.pr}`;
    case "review_posted":
      return `gh.event.dungeonadventures.pull_request_review.submitted.${e.pr}`;
    case "check_run":
      return `gh.event.dungeonadventures.check_run.completed.${e.pr}`;
    case "copilot_session_started":
      return `gh.event.dungeonadventures.copilot_session.started.${e.pr}`;
    case "copilot_session_ended":
      return `gh.event.dungeonadventures.copilot_session.ended.${e.pr}`;
    case "merge_decision":
      return `dungeonadventures.event.merge_decision.reached.${e.pr}`;
    case "pr_merged":
    case "pr_closed":
      return `gh.event.dungeonadventures.pr.closed.${e.pr}`;
    case "issue_dispatched":
      return `gh.event.dungeonadventures.issue.dispatched.${e.issue ?? 0}`;
    case "coder_completed":
      return `droidkluster.event.coder.completed.replay-${e.id}`;
  }
}

function syntheticPayload(e: PublicEvent): Record<string, unknown> {
  const verdictMatch = /review (\w+)/.exec(e.summary);
  const pr = e.pr ?? 0;
  switch (e.kind) {
    case "pr_opened":
      return { action: "opened", pull_request: { number: pr } };
    case "review_requested":
      return { action: "review_requested", pull_request: { number: pr } };
    case "review_started":
      return { action: "review_started", pull_request: { number: pr } };
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
    case "merge_decision":
      return { pr_number: pr, verdict: /decision: (\w+)/.exec(e.summary)?.[1] ?? "DECIDED" };
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
