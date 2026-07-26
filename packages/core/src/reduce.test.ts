import { describe, expect, it } from "vitest";
import type { CanonEnvelope } from "./reduce.js";
import { emptyFleetState, reduce } from "./reduce.js";

function env(subject: string, payload: unknown, id = `id-${subject}`): CanonEnvelope {
  return { kind: "event", id, subject, ts: "2026-07-25T14:00:00Z", payload };
}

const prOpened = env("gh.event.project.pr.opened.1700", {
  action: "opened",
  pull_request: {
    number: 1700,
    title: "Fix disposition ladder",
    draft: false,
    head: { sha: "abc" },
  },
  repository: {
    full_name: "x/project",
    name: "project",
    owner: { login: "x" },
  },
});

describe("reduce", () => {
  it("pr.opened creates a chain with a system hop", () => {
    const { state, emitted } = reduce(emptyFleetState(), prOpened);
    const chain = state.chains.get(1700);
    expect(chain).toBeDefined();
    expect(chain?.hops[0]).toMatchObject({ droid: "system", kind: "pr_opened" });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.summary).toContain("#1700");
  });

  it("review_started marks hk-47 active on that PR", () => {
    let s = reduce(emptyFleetState(), prOpened).state;
    s = reduce(
      s,
      env("gh.event.project.pr.review_started.1700", {
        action: "review_started",
        pull_request: { number: 1700 },
        repository: { full_name: "x/project" },
      }),
    ).state;
    expect(s.droids["hk-47"].task).toBe("reviewing PR #1700");
    expect(s.droids["hk-47"].since).toBe("2026-07-25T14:00:00Z");
  });

  it("review submitted idles hk-47, records verdict, scrubs the excerpt", () => {
    let s = reduce(emptyFleetState(), prOpened).state;
    s = reduce(
      s,
      env("gh.event.project.pr.review_started.1700", {
        action: "review_started",
        pull_request: { number: 1700 },
        repository: { full_name: "x/d" },
      }),
    ).state;
    const { state, emitted } = reduce(
      s,
      env("gh.event.project.pull_request_review.submitted.1700", {
        action: "submitted",
        review: {
          state: "changes_requested",
          body: "Finding: leak at /home/svc/private/mod.ts in the pool.",
        },
        pull_request: { number: 1700, head: { sha: "abc" } },
        repository: { full_name: "x/d" },
      }),
    );
    expect(state.droids["hk-47"].task).toBeUndefined();
    expect(state.droids["hk-47"].last_action).toContain("CHANGES_REQUESTED");
    const posted = emitted.find((e) => e.kind === "review_posted");
    expect(posted?.excerpt).toBeDefined();
    expect(posted?.excerpt).not.toContain("/home/svc");
  });

  it("failed check_run activates 2-1b", () => {
    const s = reduce(emptyFleetState(), prOpened).state;
    const { state } = reduce(
      s,
      env("gh.event.project.check_run.completed.1700", {
        action: "completed",
        check_run: {
          name: "test-unit",
          conclusion: "failure",
          head_sha: "abc",
          pull_requests: [{ number: 1700 }],
        },
        repository: { full_name: "x/d" },
      }),
    );
    expect(state.droids["2-1b"].task).toBe("diagnosing PR #1700 · test-unit");
  });

  it("merge_decision records tt-8l action and completes nothing yet", () => {
    const s = reduce(emptyFleetState(), prOpened).state;
    const { state, emitted } = reduce(
      s,
      env("project.event.merge_decision.reached.1700", {
        pr_number: 1700,
        verdict: "APPROVED",
      }),
    );
    expect(state.droids["tt-8l"].last_action).toContain("APPROVED");
    expect(emitted[0]?.kind).toBe("merge_decision");
  });

  it("pr.closed with merged=true completes the chain", () => {
    const s = reduce(emptyFleetState(), prOpened).state;
    const { state } = reduce(
      s,
      env("gh.event.project.pr.closed.1700", {
        action: "closed",
        pull_request: { number: 1700, merged: true, head: { sha: "abc" } },
        repository: { full_name: "x/d" },
      }),
    );
    expect(state.chains.get(1700)?.complete).toBe(true);
  });

  it("unknown subjects are ignored without throwing", () => {
    const { emitted } = reduce(
      emptyFleetState(),
      env("gh.event.project.workflow_job.queued.9", {}),
    );
    expect(emitted).toHaveLength(0);
  });

  it("PR titles are never copied into public output", () => {
    const { emitted } = reduce(emptyFleetState(), prOpened);
    // Title text stays private: summaries reference PR number only.
    expect(JSON.stringify(emitted)).not.toContain("Fix disposition ladder");
  });

  it("malicious check_run name is scrubbed from summary and task", () => {
    const s = reduce(emptyFleetState(), prOpened).state;
    const { state, emitted } = reduce(
      s,
      env("gh.event.project.check_run.completed.1700", {
        action: "completed",
        check_run: {
          name: "deploy https://internal-secrets.droidkluster.internal/x token ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6",
          conclusion: "failure",
          head_sha: "abc",
          pull_requests: [{ number: 1700 }],
        },
        repository: { full_name: "x/d" },
      }),
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
      env("gh.event.project.copilot_session.started.1700", {}),
    );
    expect(state.droids.copilot.task).toBe("implementing on PR #1700");
    expect(state.droids["2-1b"].last_action).toContain("diagnosis delivered");
  });

  it("copilot_session ended idles copilot", () => {
    const { state } = reduce(
      emptyFleetState(),
      env("gh.event.project.copilot_session.ended.1700", {}),
    );
    expect(state.droids.copilot.task).toBeUndefined();
    expect(state.droids.copilot.last_action).toContain("session ended");
  });

  it("review_requested emits a system hop", () => {
    const { state, emitted } = reduce(
      emptyFleetState(),
      env("gh.event.project.pr.review_requested.1700", {
        pull_request: { number: 1700 },
        repository: { full_name: "x/d" },
      }),
    );
    expect(emitted[0]?.kind).toBe("review_requested");
    expect(emitted[0]?.droid).toBe("system");
    const chain = state.chains.get(1700);
    expect(chain?.hops[0]?.kind).toBe("review_requested");
  });

  it("successful check_run does not activate 2-1b", () => {
    const s = reduce(emptyFleetState(), prOpened).state;
    const { state, emitted } = reduce(
      s,
      env("gh.event.project.check_run.completed.1700", {
        action: "completed",
        check_run: {
          name: "test-unit",
          conclusion: "success",
          head_sha: "abc",
          pull_requests: [{ number: 1700 }],
        },
        repository: { full_name: "x/d" },
      }),
    );
    expect(state.droids["2-1b"].task).toBeUndefined();
    expect(emitted[0]?.droid).toBe("system");
  });

  it("unexpected review state falls back to COMMENTED", () => {
    const { state, emitted } = reduce(
      emptyFleetState(),
      env("gh.event.project.pull_request_review.submitted.1700", {
        action: "submitted",
        review: { state: "sneaky<script>", body: "safe text" },
        pull_request: { number: 1700, head: { sha: "abc" } },
        repository: { full_name: "x/d" },
      }),
    );
    const summary = emitted[0]?.summary ?? "";
    expect(summary).toContain("COMMENTED");
    expect(summary.toUpperCase()).not.toContain("SNEAKY");
  });
});
