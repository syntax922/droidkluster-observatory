import { describe, expect, it } from "vitest";
import { CurrentSnapshotSchema, PublicEventSchema, ReplayBundleSchema } from "./schema.js";

const validEvent = {
  id: "evt-001",
  at: "2026-07-25T14:00:00Z",
  droid: "hk-47",
  kind: "review_posted",
  pr: 1607,
  summary: "posted CHANGES_REQUESTED on PR #1607",
  excerpt: "Finding: the retry loop swallows the terminal error class.",
};

describe("PublicEventSchema", () => {
  it("accepts a valid event", () => {
    expect(PublicEventSchema.parse(validEvent)).toMatchObject({ pr: 1607 });
  });
  it("rejects unknown droid ids", () => {
    expect(PublicEventSchema.safeParse({ ...validEvent, droid: "r2-d2" }).success).toBe(false);
  });
  it("rejects extra fields (strict — deny by default)", () => {
    expect(PublicEventSchema.safeParse({ ...validEvent, internal_host: "x" }).success).toBe(false);
  });
});

describe("CurrentSnapshotSchema", () => {
  it("accepts a minimal snapshot", () => {
    const snap = {
      generated_at: "2026-07-25T14:00:00Z",
      last_contact: "2026-07-25T14:00:00Z",
      droids: [{ droid: "tt-8l", state: "idle" }],
      chains: [],
    };
    expect(CurrentSnapshotSchema.parse(snap).droids).toHaveLength(1);
  });
});

describe("ReplayBundleSchema", () => {
  it("requires at least one event", () => {
    const bundle = {
      id: "pr-1607-2026-07-23",
      title: "PR #1607 full cycle",
      captured_on: "2026-07-23",
      pr: 1607,
      events: [],
    };
    expect(ReplayBundleSchema.safeParse(bundle).success).toBe(false);
  });
});
