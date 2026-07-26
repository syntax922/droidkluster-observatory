import type { Chain } from "@observatory/core";
import { describe, expect, it } from "vitest";
import { renderChains } from "./chains.js";

const chain: Chain = {
  pr: 1607,
  updated_at: "2026-07-25T14:00:00Z",
  active: true,
  complete: false,
  hops: [
    { at: "2026-07-25T13:00:00Z", droid: "system", kind: "pr_opened", label: "PR #1607 opened" },
    {
      at: "2026-07-25T13:05:00Z",
      droid: "hk-47",
      kind: "review_posted",
      label: "review CHANGES_REQUESTED · PR #1607",
    },
  ],
};

describe("renderChains", () => {
  it("renders a row per chain with hops in order", () => {
    const el = document.createElement("div");
    renderChains(el, [chain]);
    const rows = el.querySelectorAll(".chain");
    expect(rows).toHaveLength(1);
    const hops = rows[0]?.querySelectorAll(".hop");
    expect(hops).toHaveLength(2);
    expect(hops?.[1]?.textContent).toContain("CHANGES_REQUESTED");
    expect(rows[0]?.textContent).toContain("PR #1607");
  });
  it("empty state renders the idle message", () => {
    const el = document.createElement("div");
    renderChains(el, []);
    expect(el.textContent).toContain("no active chains");
  });
});
