import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReplayBundleSchema } from "@observatory/core";
import { describe, expect, it } from "vitest";
import { ingest } from "./ingest.js";

const OPTS = { repo: "exampleproj" };

const lines = [
  {
    kind: "event",
    id: "r1",
    subject: "gh.event.exampleproj.pr.opened.42",
    ts: "2026-07-25T10:00:00Z",
    payload: {
      action: "opened",
      pull_request: { number: 42, head: { sha: "x" } },
      repository: { full_name: "x/d" },
    },
  },
  {
    kind: "event",
    id: "r2",
    subject: "gh.event.exampleproj.pr.review_started.42",
    ts: "2026-07-25T10:05:00Z",
    payload: {
      action: "review_started",
      pull_request: { number: 42 },
      repository: { full_name: "x/d" },
    },
  },
  {
    kind: "event",
    id: "r3",
    subject: "gh.event.exampleproj.pull_request_review.submitted.42",
    ts: "2026-07-25T10:09:00Z",
    payload: {
      action: "submitted",
      review: { state: "approved", body: "Clean. Host was 10.0.0.9 during test." },
      pull_request: { number: 42, head: { sha: "x" } },
      repository: { full_name: "x/d" },
    },
  },
  {
    kind: "event",
    id: "r4",
    subject: "gh.event.exampleproj.pr.closed.42",
    ts: "2026-07-25T10:20:00Z",
    payload: {
      action: "closed",
      pull_request: { number: 42, merged: true, head: { sha: "x" } },
      repository: { full_name: "x/d" },
    },
  },
];

describe("ingest", () => {
  it("produces a schema-valid, scrubbed bundle per PR with >=3 events", () => {
    const dir = mkdtempSync(join(tmpdir(), "ingest-"));
    const input = join(dir, "rec.jsonl");
    writeFileSync(input, lines.map((l) => JSON.stringify(l)).join("\n"));
    const written = ingest(input, dir, OPTS);
    expect(written).toEqual(["pr-42-2026-07-25.json"]);
    const bundle = ReplayBundleSchema.parse(
      JSON.parse(readFileSync(join(dir, "pr-42-2026-07-25.json"), "utf8")),
    );
    expect(bundle.events.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(bundle)).not.toContain("10.0.0.9"); // scrubbed by the reducer path
  });

  it("drops PRs with fewer than 3 events", () => {
    const dir = mkdtempSync(join(tmpdir(), "ingest-"));
    const input = join(dir, "rec.jsonl");
    writeFileSync(input, JSON.stringify(lines[0]));
    expect(ingest(input, dir, OPTS)).toEqual([]);
    expect(readdirSync(dir).filter((f) => f.endsWith(".json"))).toEqual([]);
  });

  it("drops the fleet's canary PR (99999) by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "ingest-"));
    const input = join(dir, "rec.jsonl");
    const canaryLines = lines.map((l) => ({
      ...l,
      id: `canary-${l.id}`,
      subject: l.subject.replace(".42", ".99999"),
      payload: {
        ...l.payload,
        pull_request: { ...l.payload.pull_request, number: 99999 },
      },
    }));
    writeFileSync(input, [...lines, ...canaryLines].map((l) => JSON.stringify(l)).join("\n"));
    const written = ingest(input, dir, OPTS);
    expect(written).toEqual(["pr-42-2026-07-25.json"]);
    expect(written.some((f) => f.includes("99999"))).toBe(false);
  });

  it("creates output directory if it does not exist", () => {
    const tempBase = mkdtempSync(join(tmpdir(), "ingest-"));
    const outDir = join(tempBase, "nonexistent", "subdir");
    const input = join(tempBase, "rec.jsonl");
    writeFileSync(input, lines.map((l) => JSON.stringify(l)).join("\n"));
    const written = ingest(input, outDir, OPTS);
    expect(written).toEqual(["pr-42-2026-07-25.json"]);
    const bundle = ReplayBundleSchema.parse(
      JSON.parse(readFileSync(join(outDir, "pr-42-2026-07-25.json"), "utf8")),
    );
    expect(bundle.events.length).toBeGreaterThanOrEqual(3);
  });
});
