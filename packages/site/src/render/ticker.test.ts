import type { PublicEvent } from "@observatory/core";
import { describe, expect, it } from "vitest";
import { renderTicker } from "./ticker.js";

const events: PublicEvent[] = [
  {
    id: "1",
    at: "2026-07-25T14:00:00Z",
    droid: "hk-47",
    kind: "review_posted",
    pr: 5,
    summary: "review APPROVED · PR #5",
  },
  {
    id: "2",
    at: "2026-07-25T14:01:00Z",
    droid: "tt-8l",
    kind: "merge_decision",
    pr: 5,
    summary: "merge decision: APPROVED · PR #5",
    excerpt: "All checks green on live head.",
  },
];

describe("renderTicker", () => {
  it("renders newest first with excerpts indented", () => {
    const el = document.createElement("div");
    renderTicker(el, events);
    const lines = el.querySelectorAll(".tick");
    expect(lines[0]?.textContent).toContain("merge decision");
    expect(lines[0]?.querySelector(".tick-excerpt")?.textContent).toContain("checks green");
    expect(lines[1]?.textContent).toContain("APPROVED · PR #5");
  });
});
