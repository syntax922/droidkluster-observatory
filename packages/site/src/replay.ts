import {
  type CurrentSnapshot,
  type PublicEvent,
  type ReplayBundle,
  emptyFleetState,
  reduce,
  toSnapshot,
} from "@observatory/core";

export function replayLabel(bundle: ReplayBundle, compression: number): string {
  return `REPLAY — PR #${bundle.pr}, ${bundle.captured_on} (time ×${compression})`;
}

const TARGET_PLAYBACK_S = 90;

export function pickCompression(bundle: ReplayBundle): number {
  const first = bundle.events[0];
  const last = bundle.events[bundle.events.length - 1];
  if (!first || !last) return 10;
  const spanS = Math.max(1, (Date.parse(last.at) - Date.parse(first.at)) / 1000);
  return Math.min(600, Math.max(10, Math.round(spanS / TARGET_PLAYBACK_S)));
}

export interface ReplayOpts {
  compression: number;
  onFrame: (snap: CurrentSnapshot, feed: PublicEvent[], label: string) => void;
  onDone: () => void;
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
    const label = replayLabel(this.bundle, this.opts.compression);
    const t0 = Date.parse(this.bundle.events[0]?.at ?? new Date(0).toISOString());

    this.bundle.events.forEach((event, i) => {
      const delayMs = Math.trunc((Date.parse(event.at) - t0) / this.opts.compression);
      const fire = (): void => {
        if (this.stopped) return;
        reduce(state, {
          kind: "event",
          id: `replay-${event.id}`,
          subject: syntheticSubject(event),
          ts: event.at,
          payload: syntheticPayload(event),
        });
        feed.push(event);
        this.opts.onFrame(toSnapshot(state, new Date(event.at)), feed, label);
        if (i === this.bundle.events.length - 1) this.opts.onDone();
      };
      if (delayMs <= 0) {
        if (!this.stopped) fire();
      } else {
        if (!this.stopped) this.timers.push(setTimeout(fire, delayMs));
      }
    });
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
      return `gh.event.project.pr.opened.${e.pr}`;
    case "review_requested":
      return `gh.event.project.pr.review_requested.${e.pr}`;
    case "review_started":
      return `gh.event.project.pr.review_started.${e.pr}`;
    case "review_posted":
      return `gh.event.project.pull_request_review.submitted.${e.pr}`;
    case "check_run":
      return `gh.event.project.check_run.completed.${e.pr}`;
    case "copilot_session_started":
      return `gh.event.project.copilot_session.started.${e.pr}`;
    case "copilot_session_ended":
      return `gh.event.project.copilot_session.ended.${e.pr}`;
    case "merge_decision":
      return `project.event.merge_decision.reached.${e.pr}`;
    case "pr_merged":
    case "pr_closed":
      return `gh.event.project.pr.closed.${e.pr}`;
    case "issue_dispatched":
      return `gh.event.project.issue.dispatched.${e.issue ?? 0}`;
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
        repository: { full_name: "replay/replay" },
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
