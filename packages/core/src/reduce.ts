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
}

function classify(subject: string, payload: unknown): Classified | null {
  const p = obj(payload) ?? {};
  const tokens = subject.split(".");

  // merge-decider family: dungeonadventures.event.merge_decision.reached.<pr>
  if (subject.startsWith("dungeonadventures.event.merge_decision.reached.")) {
    const pr = num(p.pr_number) ?? num(Number(tokens[tokens.length - 1]));
    const rawVerdict = (str(p.verdict) ?? "DECIDED").toUpperCase();
    const verdict = ["APPROVED", "REJECTED", "DEFERRED", "DECIDED"].includes(rawVerdict)
      ? rawVerdict
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

  // coder-completed family: droidkluster.event.coder.completed.<id>
  if (subject.startsWith("droidkluster.event.coder.completed.")) {
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

  // canon gh family: gh.event.dungeonadventures.<entity>.<verb>.<idtail>
  if (!subject.startsWith("gh.event.dungeonadventures.") || tokens.length < 6) return null;
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
      ...(body ? { excerpt: scrubExcerpt(body) } : {}),
      idle: { droid: "hk-47", last_action: `posted ${verdict} on PR #${pr}` },
    };
  }

  if (entity === "check_run" && verb === "completed") {
    const cr = obj(p.check_run);
    const pr = num(obj((cr?.pull_requests as unknown[] | undefined)?.[0])?.number);
    const name = scrubExcerpt(str(cr?.name) ?? "check").slice(0, 40);
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

export function reduce(
  state: FleetState,
  env: CanonEnvelope,
  opts?: { ignorePrs?: ReadonlySet<number> },
): { state: FleetState; emitted: PublicEvent[] } {
  const c = classify(env.subject, env.payload);
  if (!c) return { state, emitted: [] };
  if (c.pr !== undefined && opts?.ignorePrs?.has(c.pr)) return { state, emitted: [] };
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
  }

  state.feed.push(event);
  if (state.feed.length > FEED_MAX) state.feed.shift();

  return { state, emitted: [event] };
}
