import { describe, expect, it } from "vitest";
import { emptyFleetState, reduce } from "./reduce.js";
import { CurrentSnapshotSchema } from "./schema.js";
import { toSnapshot } from "./snapshot.js";

const T0 = "2026-07-25T14:00:00Z";

function stateWithActiveReview() {
  let s = emptyFleetState();
  s = reduce(s, {
    kind: "event",
    id: "a",
    subject: "gh.event.dungeonadventures.pr.opened.5",
    ts: T0,
    payload: {
      action: "opened",
      pull_request: { number: 5, head: { sha: "x" } },
      repository: { full_name: "x/d" },
    },
  }).state;
  s = reduce(s, {
    kind: "event",
    id: "b",
    subject: "gh.event.dungeonadventures.pr.review_started.5",
    ts: T0,
    payload: {
      action: "review_started",
      pull_request: { number: 5 },
      repository: { full_name: "x/d" },
    },
  }).state;
  return s;
}

describe("toSnapshot", () => {
  it("emits a schema-valid snapshot with the active droid", () => {
    const snap = toSnapshot(stateWithActiveReview(), new Date("2026-07-25T14:02:00Z"));
    expect(CurrentSnapshotSchema.parse(snap)).toBeTruthy();
    const hk = snap.droids.find((d) => d.droid === "hk-47");
    expect(hk?.state).toBe("active");
    expect(hk?.task).toBe("reviewing PR #5");
  });

  it("expires an active task past ACTIVE_TTL_MIN", () => {
    const snap = toSnapshot(stateWithActiveReview(), new Date("2026-07-25T14:20:00Z"));
    expect(snap.droids.find((d) => d.droid === "hk-47")?.state).toBe("idle");
  });

  it("marks chains inactive outside the activity window and caps the list", () => {
    const snap = toSnapshot(stateWithActiveReview(), new Date("2026-07-25T15:00:00Z"));
    expect(snap.chains[0]?.active).toBe(false);
  });

  it("strips internal chain event logs from the public snapshot", () => {
    const snap = toSnapshot(stateWithActiveReview(), new Date("2026-07-25T14:02:00Z"));
    expect((snap.chains[0] as Record<string, unknown>).events).toBeUndefined();
  });

  it("a completed chain that receives a reopen becomes active again", () => {
    let s = emptyFleetState();
    s = reduce(s, {
      kind: "event",
      id: "a",
      subject: "gh.event.dungeonadventures.pr.opened.7",
      ts: T0,
      payload: {
        action: "opened",
        pull_request: { number: 7, head: { sha: "x" } },
        repository: { full_name: "x/d" },
      },
    }).state;
    s = reduce(s, {
      kind: "event",
      id: "b",
      subject: "gh.event.dungeonadventures.pr.closed.7",
      ts: "2026-07-25T14:01:00Z",
      payload: {
        action: "closed",
        pull_request: { number: 7, merged: false, head: { sha: "x" } },
        repository: { full_name: "x/d" },
      },
    }).state;
    // Confirm the chain is complete and inactive before the reopen.
    const closedSnap = toSnapshot(s, new Date("2026-07-25T14:02:00Z"));
    const closedChain = closedSnap.chains.find((c) => c.pr === 7);
    expect(closedChain?.complete).toBe(true);
    expect(closedChain?.active).toBe(false);

    s = reduce(s, {
      kind: "event",
      id: "c",
      subject: "gh.event.dungeonadventures.pr.reopened.7",
      ts: "2026-07-25T14:03:00Z",
      payload: {
        action: "reopened",
        pull_request: { number: 7, head: { sha: "x" } },
        repository: { full_name: "x/d" },
      },
    }).state;
    const reopenedSnap = toSnapshot(s, new Date("2026-07-25T14:04:00Z"));
    const reopenedChain = reopenedSnap.chains.find((c) => c.pr === 7);
    expect(reopenedChain?.complete).toBe(false);
    expect(reopenedChain?.active).toBe(true);
  });

  it("carries last_action_at through from the reducer's idle transition", () => {
    let s = stateWithActiveReview();
    s = reduce(s, {
      kind: "event",
      id: "c",
      subject: "gh.event.dungeonadventures.pull_request_review.submitted.5",
      ts: "2026-07-25T14:05:00Z",
      payload: {
        action: "submitted",
        review: { state: "approved" },
        pull_request: { number: 5, head: { sha: "x" } },
        repository: { full_name: "x/d" },
      },
    }).state;
    const snap = toSnapshot(s, new Date("2026-07-25T14:06:00Z"));
    const hk = snap.droids.find((d) => d.droid === "hk-47");
    expect(hk?.last_action_at).toBe("2026-07-25T14:05:00Z");
  });
});
