import { scrubExcerpt } from "./sanitize.js";
import type { Chain, DroidId, PublicEvent, PublicEventKind } from "./schema.js";

export interface CanonEnvelope {
  kind: "event";
  id: string;
  subject: string;
  ts?: string;
  payload: unknown;
}

export interface DroidState {
  task?: string;
  since?: string;
  last_action?: string;
  last_action_at?: string;
}

export type ChainState = Chain & { events: PublicEvent[] };

export interface FleetState {
  droids: Record<DroidId, DroidState>;
  chains: Map<number, ChainState>;
  feed: PublicEvent[];
}

export const DEFAULT_CODER_LOGIN = "droidkluster";

const FEED_MAX = 100;
const CHAIN_EVENTS_MAX = 200;
const CHAIN_HOPS_MAX = 200;

export function emptyFleetState(): FleetState {
  return {
    droids: { "hk-47": {}, "2-1b": {}, "tt-8l": {}, "ev-9d9": {}, r5: {}, copilot: {} },
    chains: new Map(),
    feed: [],
  };
}

// Loose payload readers: payloads are untrusted input; read only named fields.
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function obj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
}

interface Classified {
  kind: PublicEventKind;
  droid: DroidId | "system";
  pr?: number;
  issue?: number;
  summary: string;
  excerpt?: string;
  activate?: { droid: DroidId; task: string };
  idle?: { droid: DroidId; last_action: string };
  complete?: boolean;
  reopen?: boolean;
}

// Fleet-internal orchestration events are published under the BRAND namespace
// (droidkluster.event.*), while app-domain events use the source-repo token
// (<repo>.event.*). Which one a given family uses is deployment config, not
// source: the fleet's own source defaults say `<repo>` for merge_decision and
// poster_review, but the deployed configmaps override both to `droidkluster.`
// — and a subject that doesn't match is silently dropped, which is exactly how
// 100% of merge decisions went missing. Accept either namespace so neither a
// config flip nor a source default can quietly blind the board again.
function isFamily(subject: string, repo: string, family: string): boolean {
  return (
    subject.startsWith(`droidkluster.event.${family}`) ||
    subject.startsWith(`${repo}.event.${family}`)
  );
}

function classify(
  subject: string,
  payload: unknown,
  repo: string,
  redactTerms: readonly string[],
  coderLogin: string,
): Classified | null {
  const p = obj(payload) ?? {};
  const tokens = subject.split(".");

  // merge-decider family: <repo>.event.merge_decision.reached.<pr>
  if (isFamily(subject, repo, "merge_decision.reached.")) {
    // The subject tail is the COMMAND id (a uuid), never the PR — the merge
    // decider keys its events by command. Reading the PR out of the payload is
    // the only route; `pr` is what the decider actually sends (pr_number kept
    // as a fallback for older/other publishers). Getting this wrong silently
    // dropped every merge decision: Number("<uuid>") is NaN, so the guard
    // below bailed and the event never reached the board.
    const pr = num(p.pr) ?? num(p.pr_number) ?? num(Number(tokens[tokens.length - 1]));
    // The decider's own vocabulary is approve | request_changes | comment
    // (see its MergeDecisionSchema) — the previous allowlist expected review
    // states that never arrive, so every decision rendered as "DECIDED".
    const rawVerdict = (str(p.verdict) ?? "").toLowerCase();
    const verdict =
      rawVerdict === "approve"
        ? "APPROVED"
        : rawVerdict === "request_changes"
          ? "CHANGES_REQUESTED"
          : rawVerdict === "comment"
            ? "COMMENTED"
            : "DECIDED";
    if (!pr) return null;
    return {
      kind: "merge_decision",
      droid: "tt-8l",
      pr,
      summary: `merge decision: ${verdict} · PR #${pr}`,
      idle: { droid: "tt-8l", last_action: `merge decision ${verdict} on PR #${pr}` },
    };
  }

  // poster-review family: <repo>.event.poster_review.completed.<id>
  //
  // THE start-of-rework signal. Reworks are not dispatched by PR assignment in
  // the normal flow — the review-feedback-router consumes this event and
  // publishes a coder COMMAND, which this projector (an event reader) never
  // sees. Without this branch R5 stays idle for the entire rework and only
  // appears once coder.completed lands, i.e. after the work is finished.
  //
  // The gate mirrors the router's own, exactly: review_state REQUEST_CHANGES
  // and not deduped. Both fields are on the payload, so this claims a rework
  // only when the router will actually dispatch one — a repeat verdict on an
  // unchanged head (deduped) routes nothing, and neither do we.
  if (isFamily(subject, repo, "poster_review.completed.")) {
    const pr = num(obj(p.pr)?.number) ?? num(p.pr_number);
    if (!pr) return null;
    if ((str(p.review_state) ?? "").toUpperCase() !== "REQUEST_CHANGES") return null;
    if (p.deduped === true) return null;
    return {
      kind: "rework_started",
      droid: "r5",
      pr,
      summary: `R5 reworking PR #${pr}`,
      activate: { droid: "r5", task: `reworking PR #${pr}` },
    };
  }

  // merge-queue family: <repo>.event.merge_queue.enqueue.<pr>
  // A PR admitted to the merge queue is the moment TT-8L starts working — it
  // has a package to ship. This is what puts the station into `active` (the
  // rocket-loading dock); nothing else ever did, which is why that scene was
  // unreachable in production despite shipping.
  if (isFamily(subject, repo, "merge_queue.enqueue.")) {
    const pr = num(p.pr) ?? num(Number(tokens[tokens.length - 1]));
    if (!pr) return null;
    return {
      kind: "merge_queued",
      droid: "tt-8l",
      pr,
      summary: `PR #${pr} queued for merge`,
      activate: { droid: "tt-8l", task: `merging PR #${pr}` },
    };
  }

  // merge-execution family: <repo>.event.merge.executed.<id>
  // The queue's verdict on that package: merged, refused, or a dry run. Either
  // way TT-8L's work on it is done, so the station stands down (a real merge
  // also lands a GitHub pr_merged, which is what fires the blast-off).
  if (isFamily(subject, repo, "merge.executed.")) {
    const pr = num(p.pr) ?? num(Number(tokens[tokens.length - 1]));
    if (!pr) return null;
    const rawOutcome = (str(p.outcome) ?? "executed").toLowerCase();
    const outcome = ["merged", "refused", "would_merge_test"].includes(rawOutcome)
      ? rawOutcome
      : "executed";
    return {
      kind: "merge_executed",
      droid: "tt-8l",
      pr,
      summary: `merge ${outcome} · PR #${pr}`,
      idle: { droid: "tt-8l", last_action: `merge ${outcome} · PR #${pr}` },
      ...(outcome === "merged" ? { complete: true } : {}),
    };
  }

  // coder-completed family: droidkluster.event.coder.completed.<id>
  // (brand — unchanged; droidkluster is the public brand, not the private repo token)
  if (isFamily(subject, repo, "coder.completed.")) {
    const kindField = str(p.kind);
    const pr = num(p.pr_number);
    const issue = num(p.issue_number);
    if (pr === undefined && issue === undefined) return null;
    const rawStatus = (str(p.status) ?? "completed").toLowerCase();
    const status = [
      "opened",
      "no_changes",
      "reworked",
      "no_review_kicked",
      "no_open_threads",
    ].includes(rawStatus)
      ? rawStatus
      : "completed";
    const ref = pr !== undefined ? `PR #${pr}` : `issue #${issue}`;
    const openedFromIssue = kindField === "issue" && pr !== undefined && issue !== undefined;
    return {
      kind: "coder_completed",
      droid: "r5",
      ...(pr !== undefined ? { pr } : {}),
      ...(issue !== undefined ? { issue } : {}),
      summary: openedFromIssue
        ? `PR #${pr} opened from issue #${issue}`
        : `coder ${status} · ${ref}`,
      idle: { droid: "r5", last_action: `coder ${status} · ${ref}` },
    };
  }

  // canon gh family: gh.event.<repo>.<entity>.<verb>.<idtail>
  if (!subject.startsWith(`gh.event.${repo}.`) || tokens.length < 6) return null;
  const entity = tokens[3];
  const verb = tokens[4];

  if (entity === "issue" && verb === "dispatched") {
    const issue = num(p.issue_number) ?? num(Number(tokens[5]));
    if (issue === undefined) return null;
    return {
      kind: "issue_dispatched",
      droid: "r5",
      issue,
      summary: `issue #${issue} dispatched to coder`,
      activate: { droid: "r5", task: `dispatching issue #${issue}` },
    };
  }

  if (entity === "pr") {
    const prObj = obj(p.pull_request);
    const pr = num(prObj?.number) ?? num(Number(tokens[5]));
    if (!pr) return null;
    switch (verb) {
      case "opened":
        return { kind: "pr_opened", droid: "system", pr, summary: `PR #${pr} opened` };
      case "review_requested":
        return {
          kind: "review_requested",
          droid: "system",
          pr,
          summary: `review requested · PR #${pr}`,
        };
      case "assigned": {
        // A rework STARTING is only ever a command on the bus
        // (droidkluster.command.coder.<id>) — the dispatcher deliberately does
        // not publish a dashboard event for it ("rework belongs to the PR
        // dashboard, not the issue lanes"), and this projector reads events,
        // not commands. So R5 was invisible for the entire duration of a
        // rework: the board only ever saw coder.completed, the END.
        //
        // The assignment webhook IS an event we already receive, and it is the
        // exact trigger the dispatcher itself gates on, so it is the honest
        // start-of-work signal. Any other assignee is a human action, not R5's.
        const assignee = str(obj(p.assignee)?.login);
        if (assignee !== coderLogin) return null;
        return {
          kind: "rework_started",
          droid: "r5",
          pr,
          summary: `R5 reworking PR #${pr}`,
          activate: { droid: "r5", task: `reworking PR #${pr}` },
        };
      }
      case "review_started":
        return {
          kind: "review_started",
          droid: "hk-47",
          pr,
          summary: `HK-47 review started · PR #${pr}`,
          activate: { droid: "hk-47", task: `reviewing PR #${pr}` },
        };
      case "closed": {
        const merged = prObj?.merged === true;
        return {
          kind: merged ? "pr_merged" : "pr_closed",
          droid: "system",
          pr,
          summary: merged ? `PR #${pr} merged` : `PR #${pr} closed`,
          complete: true,
        };
      }
      case "reopened":
        // A reopen returns the story to the opened stage (journey-stage
        // correct) — reuse the pr_opened kind rather than adding a new
        // PublicEventKind, and flag `reopen` so reduce() reactivates the
        // chain (clears `complete`) instead of leaving it stuck closed.
        return {
          kind: "pr_opened",
          droid: "system",
          pr,
          summary: `PR #${pr} reopened`,
          reopen: true,
        };
      default:
        return null;
    }
  }

  if (entity === "pull_request_review" && verb === "submitted") {
    const pr = num(obj(p.pull_request)?.number);
    if (!pr) return null;
    const review = obj(p.review);
    const raw = (str(review?.state) ?? "commented").toUpperCase();
    const verdict = ["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"].includes(raw)
      ? raw
      : "COMMENTED";
    const body = str(review?.body);
    return {
      kind: "review_posted",
      droid: "hk-47",
      pr,
      summary: `review ${verdict} · PR #${pr}`,
      ...(body ? { excerpt: scrubExcerpt(body, redactTerms) } : {}),
      idle: { droid: "hk-47", last_action: `posted ${verdict} on PR #${pr}` },
    };
  }

  if (entity === "check_run" && verb === "completed") {
    const cr = obj(p.check_run);
    const pr = num(obj((cr?.pull_requests as unknown[] | undefined)?.[0])?.number);
    const name = scrubExcerpt(str(cr?.name) ?? "check", redactTerms).slice(0, 40);
    const conclusion = str(cr?.conclusion) ?? "unknown";
    if (!pr) return null;
    if (conclusion === "failure") {
      return {
        kind: "check_run",
        droid: "2-1b",
        pr,
        summary: `CI red (${name}) · PR #${pr}`,
        activate: { droid: "2-1b", task: `diagnosing PR #${pr} · ${name}` },
      };
    }
    return {
      kind: "check_run",
      droid: "system",
      pr,
      summary: `CI ${conclusion} (${name}) · PR #${pr}`,
    };
  }

  if (entity === "copilot_session") {
    const pr = num(Number(tokens[5]));
    if (!pr) return null;
    const started = verb === "started" || str(p.hook_event)?.includes("started") === true;
    return started
      ? {
          kind: "copilot_session_started",
          droid: "copilot",
          pr,
          summary: `copilot session started · PR #${pr}`,
          activate: { droid: "copilot", task: `implementing on PR #${pr}` },
          // A copilot pickup also means 2-1B's diagnosis was delivered.
          idle: { droid: "2-1b", last_action: `diagnosis delivered · PR #${pr}` },
        }
      : {
          kind: "copilot_session_ended",
          droid: "copilot",
          pr,
          summary: `copilot session ended · PR #${pr}`,
          idle: { droid: "copilot", last_action: `session ended · PR #${pr}` },
        };
  }

  return null;
}

export interface ReduceOpts {
  repo: string;
  /**
   * GitHub login the coder runs as. A PR ASSIGNMENT to this login is what
   * dispatches a rework — see the fleet's issue-dispatcher, whose gate is
   * exactly action==='assigned' && assignee.login===botLogin. Configurable so
   * a change of bot identity is an env flip, not a code change.
   */
  coderLogin?: string;
  ignorePrs?: ReadonlySet<number>;
  redactTerms?: readonly string[];
}

export function reduce(
  state: FleetState,
  env: CanonEnvelope,
  opts: ReduceOpts,
): { state: FleetState; emitted: PublicEvent[] } {
  const c = classify(
    env.subject,
    env.payload,
    opts.repo,
    opts.redactTerms ?? [],
    opts.coderLogin ?? DEFAULT_CODER_LOGIN,
  );
  if (!c) return { state, emitted: [] };
  if (c.pr !== undefined && opts.ignorePrs?.has(c.pr)) return { state, emitted: [] };
  const at = env.ts ?? new Date(0).toISOString();

  const event: PublicEvent = {
    id: env.id,
    at,
    droid: c.droid,
    kind: c.kind,
    ...(c.pr !== undefined ? { pr: c.pr } : {}),
    ...(c.issue !== undefined ? { issue: c.issue } : {}),
    summary: c.summary,
    ...(c.excerpt ? { excerpt: c.excerpt } : {}),
  };

  if (c.activate) {
    state.droids[c.activate.droid].task = c.activate.task;
    state.droids[c.activate.droid].since = at;
  }
  if (c.idle) {
    state.droids[c.idle.droid] = { last_action: c.idle.last_action, last_action_at: at };
  }

  if (c.pr !== undefined) {
    let chain = state.chains.get(c.pr);
    if (!chain) {
      chain = { pr: c.pr, hops: [], updated_at: at, active: true, complete: false, events: [] };
      state.chains.set(c.pr, chain);
    }
    chain.hops.push({ at, droid: c.droid, kind: c.kind, label: c.summary });
    if (chain.hops.length > CHAIN_HOPS_MAX) chain.hops.shift();
    chain.events.push(event);
    if (chain.events.length > CHAIN_EVENTS_MAX) chain.events.shift();
    chain.updated_at = at;
    if (c.complete) chain.complete = true;
    // A reopen reactivates a closed chain: the roach motel (chains check in
    // but never check out) is exactly the bug class this guards against —
    // this is the only place `complete` is ever cleared.
    if (c.reopen) chain.complete = false;
  }

  state.feed.push(event);
  if (state.feed.length > FEED_MAX) state.feed.shift();

  return { state, emitted: [event] };
}
