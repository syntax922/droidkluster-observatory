import { describe, expect, it } from "vitest";
import type { CanonEnvelope } from "./reduce.js";
import { emptyFleetState, reduce } from "./reduce.js";

const OPTS = { repo: "exampleproj" };

function env(subject: string, payload: unknown, id = `id-${subject}`): CanonEnvelope {
  return { kind: "event", id, subject, ts: "2026-07-25T14:00:00Z", payload };
}

const prOpened = env("gh.event.exampleproj.pr.opened.1700", {
  action: "opened",
  pull_request: {
    number: 1700,
    title: "Fix disposition ladder",
    draft: false,
    head: { sha: "abc" },
  },
  repository: {
    full_name: "x/exampleproj",
    name: "exampleproj",
    owner: { login: "x" },
  },
});

describe("reduce", () => {
  it("pr.opened creates a chain with a system hop", () => {
    const { state, emitted } = reduce(emptyFleetState(), prOpened, OPTS);
    const chain = state.chains.get(1700);
    expect(chain).toBeDefined();
    expect(chain?.hops[0]).toMatchObject({ droid: "system", kind: "pr_opened" });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.summary).toContain("#1700");
  });

  it("review_started marks hk-47 active on that PR", () => {
    let s = reduce(emptyFleetState(), prOpened, OPTS).state;
    s = reduce(
      s,
      env("gh.event.exampleproj.pr.review_started.1700", {
        action: "review_started",
        pull_request: { number: 1700 },
        repository: { full_name: "x/exampleproj" },
      }),
      OPTS,
    ).state;
    expect(s.droids["hk-47"].task).toBe("reviewing PR #1700");
    expect(s.droids["hk-47"].since).toBe("2026-07-25T14:00:00Z");
  });

  it("review submitted idles hk-47, records verdict, scrubs the excerpt", () => {
    let s = reduce(emptyFleetState(), prOpened, OPTS).state;
    s = reduce(
      s,
      env("gh.event.exampleproj.pr.review_started.1700", {
        action: "review_started",
        pull_request: { number: 1700 },
        repository: { full_name: "x/d" },
      }),
      OPTS,
    ).state;
    const { state, emitted } = reduce(
      s,
      env("gh.event.exampleproj.pull_request_review.submitted.1700", {
        action: "submitted",
        review: {
          state: "changes_requested",
          body: "Finding: leak at /home/svc/private/mod.ts in the pool.",
        },
        pull_request: { number: 1700, head: { sha: "abc" } },
        repository: { full_name: "x/d" },
      }),
      OPTS,
    );
    expect(state.droids["hk-47"].task).toBeUndefined();
    expect(state.droids["hk-47"].last_action).toContain("CHANGES_REQUESTED");
    expect(state.droids["hk-47"].last_action_at).toBe("2026-07-25T14:00:00Z");
    const posted = emitted.find((e) => e.kind === "review_posted");
    expect(posted?.excerpt).toBeDefined();
    expect(posted?.excerpt).not.toContain("/home/svc");
  });

  it("failed check_run activates 2-1b", () => {
    const s = reduce(emptyFleetState(), prOpened, OPTS).state;
    const { state } = reduce(
      s,
      env("gh.event.exampleproj.check_run.completed.1700", {
        action: "completed",
        check_run: {
          name: "test-unit",
          conclusion: "failure",
          head_sha: "abc",
          pull_requests: [{ number: 1700 }],
        },
        repository: { full_name: "x/d" },
      }),
      OPTS,
    );
    expect(state.droids["2-1b"].task).toBe("diagnosing PR #1700 · test-unit");
  });

  it("merge_decision reads the PR from the payload — the subject tail is a command uuid", () => {
    // Producer-faithful fixture: the merge decider keys the subject by COMMAND
    // id and carries the PR as `pr` (see its own publish call). The previous
    // fixture invented `pr_number` + an uppercase verdict, so it passed while
    // every real event was being dropped — Number("<uuid>") is NaN.
    const s = reduce(emptyFleetState(), prOpened, OPTS).state;
    const { state, emitted } = reduce(
      s,
      env("exampleproj.event.merge_decision.reached.8dde3b0b-0d79-546b-a141-94b0bac82909", {
        pr: 1700,
        verdict: "approve",
      }),
      OPTS,
    );
    expect(emitted[0]?.kind).toBe("merge_decision");
    expect(emitted[0]?.pr).toBe(1700);
    expect(state.droids["tt-8l"].last_action).toContain("APPROVED");
    expect(state.droids["tt-8l"].last_action_at).toBe("2026-07-25T14:00:00Z");
  });

  it("merge_decision maps the decider's own verdict vocabulary", () => {
    const verdictFor = (raw: string) => {
      const { emitted } = reduce(
        emptyFleetState(),
        env("exampleproj.event.merge_decision.reached.cmd-uuid", { pr: 1700, verdict: raw }),
        OPTS,
      );
      return emitted[0]?.summary ?? "";
    };
    expect(verdictFor("approve")).toContain("APPROVED");
    expect(verdictFor("request_changes")).toContain("CHANGES_REQUESTED");
    expect(verdictFor("comment")).toContain("COMMENTED");
    expect(verdictFor("something_new")).toContain("DECIDED");
  });

  it("merge_queue.enqueue ACTIVATES tt-8l — the only thing that ever does", () => {
    const s = reduce(emptyFleetState(), prOpened, OPTS).state;
    const { state, emitted } = reduce(
      s,
      env("exampleproj.event.merge_queue.enqueue.1700", { pr: 1700, queue_depth: 1 }),
      OPTS,
    );
    expect(emitted[0]?.kind).toBe("merge_queued");
    expect(state.droids["tt-8l"].task).toBe("merging PR #1700");
    expect(state.droids["tt-8l"].since).toBe("2026-07-25T14:00:00Z");
  });

  it("merge.executed stands tt-8l down and completes the chain only when merged", () => {
    const queued = reduce(
      reduce(emptyFleetState(), prOpened, OPTS).state,
      env("exampleproj.event.merge_queue.enqueue.1700", { pr: 1700 }),
      OPTS,
    ).state;
    const merged = reduce(
      queued,
      env("exampleproj.event.merge.executed.abc-uuid", { pr: 1700, outcome: "merged" }),
      OPTS,
    );
    expect(merged.emitted[0]?.kind).toBe("merge_executed");
    expect(merged.state.droids["tt-8l"].task).toBeUndefined();
    expect(merged.state.droids["tt-8l"].last_action).toContain("merged");
    expect(merged.state.chains.get(1700)?.complete).toBe(true);

    const refused = reduce(
      reduce(
        reduce(emptyFleetState(), prOpened, OPTS).state,
        env("exampleproj.event.merge_queue.enqueue.1700", { pr: 1700 }),
        OPTS,
      ).state,
      env("exampleproj.event.merge.executed.def-uuid", { pr: 1700, outcome: "refused" }),
      OPTS,
    );
    expect(refused.state.chains.get(1700)?.complete).toBe(false);
    expect(refused.state.droids["tt-8l"].last_action).toContain("refused");
  });

  it("pr.closed with merged=true completes the chain", () => {
    const s = reduce(emptyFleetState(), prOpened, OPTS).state;
    const { state } = reduce(
      s,
      env("gh.event.exampleproj.pr.closed.1700", {
        action: "closed",
        pull_request: { number: 1700, merged: true, head: { sha: "abc" } },
        repository: { full_name: "x/d" },
      }),
      OPTS,
    );
    expect(state.chains.get(1700)?.complete).toBe(true);
  });

  it("pr.reopened classifies as pr_opened, tagged reopen, from system", () => {
    let s = reduce(emptyFleetState(), prOpened, OPTS).state;
    s = reduce(
      s,
      env("gh.event.exampleproj.pr.closed.1700", {
        action: "closed",
        pull_request: { number: 1700, merged: false, head: { sha: "abc" } },
        repository: { full_name: "x/d" },
      }),
      OPTS,
    ).state;
    expect(s.chains.get(1700)?.complete).toBe(true);
    const { state, emitted } = reduce(
      s,
      env("gh.event.exampleproj.pr.reopened.1700", {
        action: "reopened",
        pull_request: { number: 1700, head: { sha: "abc" } },
        repository: { full_name: "x/d" },
      }),
      OPTS,
    );
    expect(emitted[0]).toMatchObject({ kind: "pr_opened", droid: "system", pr: 1700 });
    expect(emitted[0]?.summary).toBe("PR #1700 reopened");
    expect(state.chains.get(1700)?.hops.at(-1)).toMatchObject({
      kind: "pr_opened",
      label: "PR #1700 reopened",
    });
  });

  it("pr.reopened on a completed chain reactivates it (clears complete)", () => {
    let s = reduce(emptyFleetState(), prOpened, OPTS).state;
    s = reduce(
      s,
      env("gh.event.exampleproj.pr.closed.1700", {
        action: "closed",
        pull_request: { number: 1700, merged: false, head: { sha: "abc" } },
        repository: { full_name: "x/d" },
      }),
      OPTS,
    ).state;
    expect(s.chains.get(1700)?.complete).toBe(true);
    const { state } = reduce(
      s,
      env("gh.event.exampleproj.pr.reopened.1700", {
        action: "reopened",
        pull_request: { number: 1700, head: { sha: "abc" } },
        repository: { full_name: "x/d" },
      }),
      OPTS,
    );
    expect(state.chains.get(1700)?.complete).toBe(false);
  });

  it("pr.reopened on a chain that was never closed leaves complete=false (no-op, not a crash)", () => {
    const s = reduce(emptyFleetState(), prOpened, OPTS).state;
    expect(s.chains.get(1700)?.complete).toBe(false);
    const { state } = reduce(
      s,
      env("gh.event.exampleproj.pr.reopened.1700", {
        action: "reopened",
        pull_request: { number: 1700, head: { sha: "abc" } },
        repository: { full_name: "x/d" },
      }),
      OPTS,
    );
    expect(state.chains.get(1700)?.complete).toBe(false);
  });

  it("unknown subjects are ignored without throwing", () => {
    const { emitted } = reduce(
      emptyFleetState(),
      env("gh.event.exampleproj.workflow_job.queued.9", {}),
      OPTS,
    );
    expect(emitted).toHaveLength(0);
  });

  it("PR titles are never copied into public output", () => {
    const { emitted } = reduce(emptyFleetState(), prOpened, OPTS);
    // Title text stays private: summaries reference PR number only.
    expect(JSON.stringify(emitted)).not.toContain("Fix disposition ladder");
  });

  it("malicious check_run name is scrubbed from summary and task", () => {
    const s = reduce(emptyFleetState(), prOpened, OPTS).state;
    const { state, emitted } = reduce(
      s,
      env("gh.event.exampleproj.check_run.completed.1700", {
        action: "completed",
        check_run: {
          name: "deploy https://internal-secrets.droidkluster.internal/x token ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6",
          conclusion: "failure",
          head_sha: "abc",
          pull_requests: [{ number: 1700 }],
        },
        repository: { full_name: "x/d" },
      }),
      OPTS,
    );
    expect(state.droids["2-1b"].task).not.toContain("droidkluster.internal");
    expect(state.droids["2-1b"].task).not.toContain("ghp_");
    const summary = emitted[0]?.summary ?? "";
    expect(summary).not.toContain("droidkluster.internal");
    expect(summary).not.toContain("ghp_");
  });

  it("copilot_session started activates copilot and idles 2-1b", () => {
    const { state } = reduce(
      emptyFleetState(),
      env("gh.event.exampleproj.copilot_session.started.1700", {}),
      OPTS,
    );
    expect(state.droids.copilot.task).toBe("implementing on PR #1700");
    expect(state.droids["2-1b"].last_action).toContain("diagnosis delivered");
    expect(state.droids["2-1b"].last_action_at).toBe("2026-07-25T14:00:00Z");
  });

  it("copilot_session ended idles copilot", () => {
    const { state } = reduce(
      emptyFleetState(),
      env("gh.event.exampleproj.copilot_session.ended.1700", {}),
      OPTS,
    );
    expect(state.droids.copilot.task).toBeUndefined();
    expect(state.droids.copilot.last_action).toContain("session ended");
    expect(state.droids.copilot.last_action_at).toBe("2026-07-25T14:00:00Z");
  });

  it("review_requested emits a system hop", () => {
    const { state, emitted } = reduce(
      emptyFleetState(),
      env("gh.event.exampleproj.pr.review_requested.1700", {
        pull_request: { number: 1700 },
        repository: { full_name: "x/d" },
      }),
      OPTS,
    );
    expect(emitted[0]?.kind).toBe("review_requested");
    expect(emitted[0]?.droid).toBe("system");
    const chain = state.chains.get(1700);
    expect(chain?.hops[0]?.kind).toBe("review_requested");
  });

  it("successful check_run does not activate 2-1b", () => {
    const s = reduce(emptyFleetState(), prOpened, OPTS).state;
    const { state, emitted } = reduce(
      s,
      env("gh.event.exampleproj.check_run.completed.1700", {
        action: "completed",
        check_run: {
          name: "test-unit",
          conclusion: "success",
          head_sha: "abc",
          pull_requests: [{ number: 1700 }],
        },
        repository: { full_name: "x/d" },
      }),
      OPTS,
    );
    expect(state.droids["2-1b"].task).toBeUndefined();
    expect(emitted[0]?.droid).toBe("system");
  });

  it("unexpected review state falls back to COMMENTED", () => {
    const { emitted } = reduce(
      emptyFleetState(),
      env("gh.event.exampleproj.pull_request_review.submitted.1700", {
        action: "submitted",
        review: { state: "sneaky<script>", body: "safe text" },
        pull_request: { number: 1700, head: { sha: "abc" } },
        repository: { full_name: "x/d" },
      }),
      OPTS,
    );
    const summary = emitted[0]?.summary ?? "";
    expect(summary).toContain("COMMENTED");
    expect(summary.toUpperCase()).not.toContain("SNEAKY");
  });

  it("classifies only subjects under the configured repo token", () => {
    const s = emptyFleetState();
    const hit = reduce(
      s,
      {
        kind: "event",
        id: "e1",
        subject: "gh.event.exampleproj.pr.opened.7",
        ts: "2026-07-27T00:00:00Z",
        payload: { pull_request: { number: 7 } },
      },
      OPTS,
    );
    expect(hit.emitted).toHaveLength(1);

    const miss = reduce(
      s,
      {
        kind: "event",
        id: "e2",
        subject: "gh.event.project.pr.opened.7",
        ts: "2026-07-27T00:00:00Z",
        payload: { pull_request: { number: 7 } },
      },
      OPTS,
    );
    expect(miss.emitted).toHaveLength(0);
  });

  it("parameterizes the merge-decision family too", () => {
    const s = emptyFleetState();
    const r = reduce(
      s,
      {
        kind: "event",
        id: "e3",
        subject: "exampleproj.event.merge_decision.reached.7",
        ts: "2026-07-27T00:00:00Z",
        payload: { pr_number: 7, verdict: "APPROVED" },
      },
      OPTS,
    );
    expect(r.emitted[0]?.kind).toBe("merge_decision");
  });

  it("threads redactTerms into excerpt scrubbing", () => {
    const s = emptyFleetState();
    const r = reduce(
      s,
      {
        kind: "event",
        id: "e4",
        subject: "gh.event.exampleproj.pull_request_review.submitted.7",
        ts: "2026-07-27T00:00:00Z",
        payload: {
          pull_request: { number: 7 },
          review: { state: "approved", body: "exampleproj looks good" },
        },
      },
      { repo: "exampleproj", redactTerms: ["exampleproj"] },
    );
    expect(r.emitted[0]?.excerpt).toBe("[project] looks good");
  });
});

describe("canary-PR filter (opts.ignorePrs)", () => {
  it("ignored PR emits nothing and mutates nothing", () => {
    const before = emptyFleetState();
    const { state, emitted } = reduce(before, prOpened, { ...OPTS, ignorePrs: new Set([1700]) });
    expect(emitted).toHaveLength(0);
    expect(state.chains.size).toBe(0);
    expect(state.feed).toHaveLength(0);
    expect(state.droids["hk-47"]).toEqual({});
  });

  it("non-ignored PRs are unaffected when opts is present", () => {
    const other = env("gh.event.exampleproj.pr.opened.42", {
      action: "opened",
      pull_request: { number: 42, head: { sha: "abc" } },
      repository: { full_name: "x/exampleproj" },
    });
    const { state, emitted } = reduce(emptyFleetState(), other, {
      ...OPTS,
      ignorePrs: new Set([1700]),
    });
    expect(emitted).toHaveLength(1);
    expect(state.chains.get(42)).toBeDefined();
  });

  it("canary review_started does NOT set hk-47 task", () => {
    let s = reduce(emptyFleetState(), prOpened, { ...OPTS, ignorePrs: new Set([1700]) }).state;
    s = reduce(
      s,
      env("gh.event.exampleproj.pr.review_started.1700", {
        action: "review_started",
        pull_request: { number: 1700 },
        repository: { full_name: "x/d" },
      }),
      { ...OPTS, ignorePrs: new Set([1700]) },
    ).state;
    expect(s.droids["hk-47"].task).toBeUndefined();
    expect(s.droids["hk-47"].since).toBeUndefined();
  });

  it("calling with only repo (no ignorePrs) leaves existing callers unaffected (site replay stays ignorePrs-free)", () => {
    const { state, emitted } = reduce(emptyFleetState(), prOpened, OPTS);
    expect(emitted).toHaveLength(1);
    expect(state.chains.get(1700)).toBeDefined();
  });
});

describe("R5 events", () => {
  it("issue.dispatched activates r5, emits issue-only event, creates no chain", () => {
    const { state, emitted } = reduce(
      emptyFleetState(),
      {
        kind: "event",
        id: "r5a",
        subject: "gh.event.exampleproj.issue.dispatched.128",
        ts: "2026-07-26T00:00:00Z",
        payload: { issue_number: 128, command_id: "cmd-1", repository: { full_name: "x/d" } },
      },
      OPTS,
    );
    expect(state.droids.r5.task).toBe("dispatching issue #128");
    expect(emitted[0]).toMatchObject({ kind: "issue_dispatched", droid: "r5", issue: 128 });
    expect(emitted[0]?.pr).toBeUndefined();
    expect(state.chains.size).toBe(0);
  });
  it("coder.completed (rework) idles r5 with allowlisted status and hops the PR chain", () => {
    const s = reduce(
      emptyFleetState(),
      {
        kind: "event",
        id: "p",
        subject: "gh.event.exampleproj.pr.opened.9",
        ts: "2026-07-26T00:00:00Z",
        payload: {
          action: "opened",
          pull_request: { number: 9, head: { sha: "x" } },
          repository: { full_name: "x/d" },
        },
      },
      OPTS,
    ).state;
    const { state, emitted } = reduce(
      s,
      {
        kind: "event",
        id: "r5b",
        subject: "droidkluster.event.coder.completed.0198cafe",
        ts: "2026-07-26T00:01:00Z",
        payload: {
          kind: "rework",
          repo: "x/d",
          pr_number: 9,
          status: "reworked",
          exit_code: 0,
        },
      },
      OPTS,
    );
    expect(state.droids.r5.task).toBeUndefined();
    expect(state.droids.r5.last_action).toBe("coder reworked · PR #9");
    expect(state.droids.r5.last_action_at).toBe("2026-07-26T00:01:00Z");
    expect(emitted[0]).toMatchObject({ kind: "coder_completed", pr: 9 });
    expect(state.chains.get(9)?.hops.at(-1)?.label).toContain("coder reworked");
  });
  it("coder.completed (issue kind) that opened a PR hops the new chain with the issue link", () => {
    const { state, emitted } = reduce(
      emptyFleetState(),
      {
        kind: "event",
        id: "r5c",
        subject: "droidkluster.event.coder.completed.0198beef",
        ts: "2026-07-26T00:02:00Z",
        payload: {
          kind: "issue",
          repo: "x/d",
          issue_number: 128,
          status: "opened",
          exit_code: 0,
          pr_number: 130,
        },
      },
      OPTS,
    );
    expect(emitted[0]).toMatchObject({ pr: 130, issue: 128 });
    expect(state.chains.get(130)?.hops[0]?.label).toBe("PR #130 opened from issue #128");
  });
  it("unexpected coder status falls back to completed", () => {
    const { emitted } = reduce(
      emptyFleetState(),
      {
        kind: "event",
        id: "r5d",
        subject: "droidkluster.event.coder.completed.0198dead",
        ts: "2026-07-26T00:03:00Z",
        payload: { kind: "rework", pr_number: 9, status: "sneaky<script>" },
      },
      OPTS,
    );
    expect(emitted[0]?.summary).toContain("coder completed");
  });
});

describe("rework visibility (R5)", () => {
  const prOpenedFirst = {
    kind: "event" as const,
    id: "e-open",
    subject: "gh.event.exampleproj.pr.opened.1770",
    ts: "2026-07-29T06:00:00Z",
    payload: { pull_request: { number: 1770 } },
  };
  const assigned = (login: string) => ({
    kind: "event" as const,
    id: `e-assign-${login}`,
    subject: "gh.event.exampleproj.pr.assigned.1770",
    ts: "2026-07-29T06:10:00Z",
    payload: { assignee: { login }, pull_request: { number: 1770 } },
  });

  it("assignment to the coder login ACTIVATES r5 — the only start-of-rework signal on the bus", () => {
    // The rework START is published only as a command
    // (droidkluster.command.coder.<id>); the dispatcher deliberately emits no
    // dashboard event for it, and this projector reads events. The assignment
    // webhook is the same trigger the dispatcher gates on, so it is the honest
    // signal — without it R5 stays idle for the whole rework and only appears
    // once coder.completed lands, i.e. after the work is over.
    const s = reduce(emptyFleetState(), prOpenedFirst, OPTS).state;
    const { state, emitted } = reduce(s, assigned("droidkluster"), OPTS);
    expect(emitted[0]?.kind).toBe("rework_started");
    expect(emitted[0]?.summary).toBe("R5 reworking PR #1770");
    expect(state.droids.r5.task).toBe("reworking PR #1770");
    expect(state.droids.r5.since).toBe("2026-07-29T06:10:00Z");
  });

  it("assignment to anyone else is a human action, not R5's — ignored", () => {
    const s = reduce(emptyFleetState(), prOpenedFirst, OPTS).state;
    const { state, emitted } = reduce(s, assigned("some-human"), OPTS);
    expect(emitted).toHaveLength(0);
    expect(state.droids.r5.task).toBeUndefined();
  });

  it("the coder login is configurable", () => {
    const s = reduce(emptyFleetState(), prOpenedFirst, OPTS).state;
    const { emitted } = reduce(s, assigned("other-bot"), { ...OPTS, coderLogin: "other-bot" });
    expect(emitted[0]?.kind).toBe("rework_started");
  });

  it("coder_completed still stands r5 down when the rework finishes", () => {
    let st = reduce(emptyFleetState(), prOpenedFirst, OPTS).state;
    st = reduce(st, assigned("droidkluster"), OPTS).state;
    expect(st.droids.r5.task).toBe("reworking PR #1770");
    const done = reduce(
      st,
      {
        kind: "event",
        id: "e-done",
        subject: "droidkluster.event.coder.completed.cmd-1",
        ts: "2026-07-29T06:28:00Z",
        payload: { kind: "rework", pr_number: 1770, status: "reworked", exit_code: 0 },
      },
      OPTS,
    );
    expect(done.state.droids.r5.task).toBeUndefined();
    expect(done.state.droids.r5.last_action).toContain("reworked");
  });
});

describe("rework start via the review-feedback-router's own input", () => {
  const posterReview = (state: string, deduped = false) => ({
    kind: "event" as const,
    id: `e-poster-${state}-${deduped}`,
    subject: "exampleproj.event.poster_review.completed.c1f-uuid",
    ts: "2026-07-29T06:18:09Z",
    payload: {
      pr: { owner: "o", repo: "r", number: 1770 },
      review_id: 55,
      review_state: state,
      deduped,
    },
  });

  it("REQUEST_CHANGES (not deduped) activates r5 — this is the real rework trigger", () => {
    // Reworks are dispatched by the review-feedback-router off THIS event; the
    // command it then publishes is invisible to an event reader. Mirroring the
    // router's gate is the only honest way to show the work while it happens.
    const { state, emitted } = reduce(emptyFleetState(), posterReview("REQUEST_CHANGES"), OPTS);
    expect(emitted[0]?.kind).toBe("rework_started");
    expect(emitted[0]?.pr).toBe(1770);
    expect(state.droids.r5.task).toBe("reworking PR #1770");
  });

  it("an approval routes no rework, so it claims none", () => {
    const { state, emitted } = reduce(emptyFleetState(), posterReview("APPROVE"), OPTS);
    expect(emitted).toHaveLength(0);
    expect(state.droids.r5.task).toBeUndefined();
  });

  it("a deduped verdict routes no rework either — same gate as the router", () => {
    const { state, emitted } = reduce(
      emptyFleetState(),
      posterReview("REQUEST_CHANGES", true),
      OPTS,
    );
    expect(emitted).toHaveLength(0);
    expect(state.droids.r5.task).toBeUndefined();
  });
});

describe("fleet namespace tolerance (deployed config vs source defaults)", () => {
  // Every one of these families is published under the BRAND namespace in the
  // deployed configmaps (RESULT_SUBJECT_PREFIX / NATS_FILTER_SUBJECT), while
  // the fleet's own source defaults say <repo>. Keying on the source default
  // is what silently dropped 100% of merge decisions — a non-matching subject
  // classifies to null and vanishes without a trace.
  const cases: Array<[string, string, Record<string, unknown>, string]> = [
    [
      "merge_decision",
      "merge_decision.reached.uuid",
      { pr: 1700, verdict: "approve" },
      "merge_decision",
    ],
    [
      "poster_review",
      "poster_review.completed.uuid",
      { pr: { number: 1770 }, review_state: "REQUEST_CHANGES", deduped: false },
      "rework_started",
    ],
    ["merge_queue", "merge_queue.enqueue.1766", { pr: 1766 }, "merge_queued"],
    ["merge_executed", "merge.executed.uuid", { pr: 1766, outcome: "merged" }, "merge_executed"],
  ];

  for (const [label, tail, payload, kind] of cases) {
    it(`${label} classifies under BOTH the brand and repo namespaces`, () => {
      for (const ns of ["droidkluster", "exampleproj"]) {
        const { emitted } = reduce(
          emptyFleetState(),
          {
            kind: "event",
            id: `e-${label}-${ns}`,
            subject: `${ns}.event.${tail}`,
            ts: "2026-07-29T08:00:00Z",
            payload,
          },
          OPTS,
        );
        expect(emitted[0]?.kind, `${label} under ${ns}`).toBe(kind);
      }
    });
  }

  it("coder.completed still classifies under the brand namespace it actually uses", () => {
    const { emitted } = reduce(
      emptyFleetState(),
      {
        kind: "event",
        id: "e-coder",
        subject: "droidkluster.event.coder.completed.uuid",
        ts: "2026-07-29T08:00:00Z",
        payload: { kind: "rework", pr_number: 1770, status: "reworked" },
      },
      OPTS,
    );
    expect(emitted[0]?.kind).toBe("coder_completed");
  });
});
