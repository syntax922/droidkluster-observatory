import type { Chain } from "@observatory/core";
import { describe, expect, it } from "vitest";
import { ACCENTS } from "../dmd/palette.js";
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
    const hops = rows[0]?.querySelectorAll(".tl-row");
    expect(hops).toHaveLength(2);
    expect(hops?.[1]?.textContent).toContain("CHANGES_REQUESTED");
    expect(rows[0]?.textContent).toContain("PR #1607");
  });

  it("chain head shows the status word", () => {
    const el = document.createElement("div");
    renderChains(el, [chain]);
    expect(el.querySelector(".chain-head")?.textContent).toContain("active");

    const el2 = document.createElement("div");
    renderChains(el2, [{ ...chain, active: false, complete: true }]);
    expect(el2.querySelector(".chain-head")?.textContent).toContain("complete");

    const el3 = document.createElement("div");
    renderChains(el3, [{ ...chain, active: false, complete: false }]);
    expect(el3.querySelector(".chain-head")?.textContent).toContain("quiet");
  });

  it("colors each node with the hop droid's accent; system hops get the dim neutral", () => {
    const el = document.createElement("div");
    renderChains(el, [chain]);
    const nodes = el.querySelectorAll(".tl-node");
    expect((nodes[0] as HTMLElement).style.backgroundColor).toBe("rgb(107, 119, 137)"); // #6b7789
    expect((nodes[1] as HTMLElement).style.backgroundColor).not.toBe("");
    expect((nodes[1] as HTMLElement).style.backgroundColor).not.toBe("rgb(107, 119, 137)");
  });

  it("omits the droid tag for system hops but shows the registry name otherwise", () => {
    const el = document.createElement("div");
    renderChains(el, [chain]);
    const rows = el.querySelectorAll(".tl-row");
    expect(rows[0]?.querySelector(".tl-droid")).toBeNull();
    expect(rows[1]?.querySelector(".tl-droid")?.textContent).toBe("HK-47");
  });

  it("offsets each hop's time label from the first hop", () => {
    const el = document.createElement("div");
    renderChains(el, [chain]);
    const times = Array.from(el.querySelectorAll(".tl-time")).map((n) => n.textContent);
    expect(times).toEqual(["+0s", "+5m"]);
  });

  it("renders an excerpt card when the lookup provides one, keyed by kind|at", () => {
    const excerptsFor = (pr: number): Map<string, string> => {
      expect(pr).toBe(1607);
      return new Map([["review_posted|2026-07-25T13:05:00Z", "This looks correct to me."]]);
    };
    const el = document.createElement("div");
    renderChains(el, [chain], excerptsFor);
    const rows = el.querySelectorAll(".tl-row");
    expect(rows[0]?.querySelector(".tl-excerpt")).toBeNull();
    const card = rows[1]?.querySelector(".tl-excerpt");
    expect(card?.textContent).toBe("This looks correct to me.");
    expect(card?.getAttribute("title")).toBe("This looks correct to me.");
  });

  it("renders no excerpt card when excerptsFor is omitted or yields no match", () => {
    const el = document.createElement("div");
    renderChains(el, [chain], () => new Map());
    expect(el.querySelector(".tl-excerpt")).toBeNull();
  });

  it("inserts a gap row between hops more than 10 minutes apart", () => {
    const gappy: Chain = {
      ...chain,
      hops: [
        chain.hops[0] as Chain["hops"][number],
        { at: "2026-07-25T13:25:00Z", droid: "hk-47", kind: "review_started", label: "started" },
      ],
    };
    const el = document.createElement("div");
    renderChains(el, [gappy]);
    const gap = el.querySelector(".tl-gap");
    expect(gap).not.toBeNull();
    expect(gap?.textContent).toContain("25m later");
  });

  it("does not insert a gap row for hops 10 minutes apart or less", () => {
    const el = document.createElement("div");
    renderChains(el, [chain]); // 5 minutes apart
    expect(el.querySelector(".tl-gap")).toBeNull();
  });

  it("marks only the active chain's last hop as .tl-now", () => {
    const el = document.createElement("div");
    renderChains(el, [chain]);
    const nodes = el.querySelectorAll(".tl-node");
    expect(nodes[0]?.classList.contains("tl-now")).toBe(false);
    expect(nodes[1]?.classList.contains("tl-now")).toBe(true);

    const complete: Chain = { ...chain, active: false, complete: true };
    const el2 = document.createElement("div");
    renderChains(el2, [complete]);
    const nodes2 = el2.querySelectorAll(".tl-node");
    expect(nodes2[1]?.classList.contains("tl-now")).toBe(false);
  });

  it("orders active chains first, then by updated_at desc", () => {
    const older: Chain = {
      ...chain,
      pr: 1,
      active: false,
      complete: true,
      updated_at: "2026-07-25T10:00:00Z",
    };
    const newerInactive: Chain = {
      ...chain,
      pr: 2,
      active: false,
      complete: true,
      updated_at: "2026-07-25T12:00:00Z",
    };
    const activeOne: Chain = {
      ...chain,
      pr: 3,
      active: true,
      complete: false,
      updated_at: "2026-07-25T09:00:00Z",
    };
    const el = document.createElement("div");
    renderChains(el, [older, newerInactive, activeOne]);
    const heads = Array.from(el.querySelectorAll(".chain-head")).map((h) => h.textContent);
    expect(heads).toEqual(["PR #3 · active", "PR #2 · complete", "PR #1 · complete"]);
  });

  it("empty state renders the idle message", () => {
    const el = document.createElement("div");
    renderChains(el, []);
    expect(el.textContent).toContain("no active chains");
  });
});

describe("renderChains — consecutive-CI batching", () => {
  function checkRunHop(at: string, label: string): Chain["hops"][number] {
    return { at, droid: "system", kind: "check_run", label };
  }

  it("collapses a run of 3+ consecutive system check_run hops into one row", () => {
    const c: Chain = {
      pr: 42,
      updated_at: "2026-07-25T14:00:00Z",
      active: false,
      complete: false,
      hops: [
        checkRunHop("2026-07-25T13:00:00Z", "CI skipped (a) · PR #42"),
        checkRunHop("2026-07-25T13:00:01Z", "CI skipped (b) · PR #42"),
        checkRunHop("2026-07-25T13:00:02Z", "CI cancelled (c) · PR #42"),
      ],
    };
    const el = document.createElement("div");
    renderChains(el, [c]);
    const rows = el.querySelectorAll(".tl-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector(".tl-label")?.textContent).toBe(
      "3 CI checks · 2 skipped, 1 cancelled",
    );
  });

  it("does not batch a run of exactly 2 consecutive system check_run hops", () => {
    const c: Chain = {
      pr: 42,
      updated_at: "2026-07-25T14:00:00Z",
      active: false,
      complete: false,
      hops: [
        checkRunHop("2026-07-25T13:00:00Z", "CI skipped (a) · PR #42"),
        checkRunHop("2026-07-25T13:00:01Z", "CI cancelled (b) · PR #42"),
      ],
    };
    const el = document.createElement("div");
    renderChains(el, [c]);
    const rows = el.querySelectorAll(".tl-row");
    expect(rows).toHaveLength(2);
    expect(el.querySelector(".tl-label")?.textContent).not.toContain("CI checks");
  });

  it("counts distinct conclusion words, most common first, alphabetical tiebreak", () => {
    const hops: Chain["hops"] = [];
    for (let i = 0; i < 7; i++)
      hops.push(checkRunHop(`2026-07-25T13:00:0${i}Z`, `CI skipped (s${i}) · PR #42`));
    for (let i = 0; i < 5; i++)
      hops.push(checkRunHop(`2026-07-25T13:00:1${i}Z`, `CI cancelled (c${i}) · PR #42`));
    const c: Chain = {
      pr: 42,
      updated_at: "2026-07-25T14:00:00Z",
      active: false,
      complete: false,
      hops,
    };
    const el = document.createElement("div");
    renderChains(el, [c]);
    expect(el.querySelector(".tl-label")?.textContent).toBe(
      "12 CI checks · 7 skipped, 5 cancelled",
    );
  });

  it("treats an unrecognized label shape as 'completed' in the summary", () => {
    const c: Chain = {
      pr: 42,
      updated_at: "2026-07-25T14:00:00Z",
      active: false,
      complete: false,
      hops: [
        checkRunHop("2026-07-25T13:00:00Z", "something odd"),
        checkRunHop("2026-07-25T13:00:01Z", "something odd"),
        checkRunHop("2026-07-25T13:00:02Z", "something odd"),
      ],
    };
    const el = document.createElement("div");
    renderChains(el, [c]);
    expect(el.querySelector(".tl-label")?.textContent).toBe("3 CI checks · 3 completed");
  });

  it("batched row uses the dim neutral node, the first hop's offset, and no title", () => {
    const c: Chain = {
      pr: 42,
      updated_at: "2026-07-25T14:00:00Z",
      active: false,
      complete: false,
      hops: [
        checkRunHop("2026-07-25T13:00:00Z", "CI skipped (a) · PR #42"),
        checkRunHop("2026-07-25T13:05:00Z", "CI skipped (b) · PR #42"),
        checkRunHop("2026-07-25T13:10:00Z", "CI skipped (c) · PR #42"),
      ],
    };
    const el = document.createElement("div");
    renderChains(el, [c]);
    const row = el.querySelector(".tl-row");
    expect((row?.querySelector(".tl-node") as HTMLElement).style.backgroundColor).toBe(
      "rgb(107, 119, 137)",
    );
    expect(row?.querySelector(".tl-time")?.textContent).toBe("+0s");
    expect(row?.querySelector(".tl-label")?.getAttribute("title")).toBeNull();
    expect(row?.getAttribute("title")).toBeNull();
  });

  it("a check_run hop attributed to 2-1B (CI-red) never batches, even amid a system run", () => {
    const c: Chain = {
      pr: 42,
      updated_at: "2026-07-25T14:00:00Z",
      active: false,
      complete: false,
      hops: [
        checkRunHop("2026-07-25T13:00:00Z", "CI skipped (a) · PR #42"),
        checkRunHop("2026-07-25T13:00:01Z", "CI skipped (b) · PR #42"),
        {
          at: "2026-07-25T13:00:02Z",
          droid: "2-1b",
          kind: "check_run",
          label: "CI red (test-unit) · PR #42",
        },
        checkRunHop("2026-07-25T13:00:03Z", "CI skipped (c) · PR #42"),
        checkRunHop("2026-07-25T13:00:04Z", "CI skipped (d) · PR #42"),
      ],
    };
    const el = document.createElement("div");
    renderChains(el, [c]);
    // The 2-1B hop splits the run into two runs of 2 — neither reaches the
    // batch threshold, so all 5 hops render individually.
    const rows = el.querySelectorAll(".tl-row");
    expect(rows).toHaveLength(5);
    expect(el.textContent).toContain("CI red (test-unit)");
    expect(el.querySelector(".tl-label")?.textContent).not.toContain("CI checks");
  });

  it("splits a run at an internal gap > 10min instead of swallowing the gap row", () => {
    const c: Chain = {
      pr: 42,
      updated_at: "2026-07-25T14:00:00Z",
      active: false,
      complete: false,
      hops: [
        checkRunHop("2026-07-25T13:00:00Z", "CI skipped (a) · PR #42"),
        checkRunHop("2026-07-25T13:05:00Z", "CI skipped (b) · PR #42"),
        checkRunHop("2026-07-25T13:30:00Z", "CI skipped (c) · PR #42"),
      ],
    };
    const el = document.createElement("div");
    renderChains(el, [c]);
    // The 25min gap between the 2nd and 3rd hop splits the run: [a,b] is
    // below the batch threshold (2 < 3) so both render unbatched, and c
    // renders as its own single hop — 3 rows total, with a gap row between
    // the 2nd and 3rd.
    const rows = el.querySelectorAll(".tl-row");
    expect(rows).toHaveLength(3);
    expect(el.querySelectorAll(".tl-label")[0]?.textContent).not.toContain("CI checks");
    const gap = el.querySelector(".tl-gap");
    expect(gap).not.toBeNull();
    expect(gap?.textContent).toContain("25m later");
  });

  it("a gap between two 3+ runs renders two batch rows with the gap row between", () => {
    const c: Chain = {
      pr: 42,
      updated_at: "2026-07-25T14:00:00Z",
      active: false,
      complete: false,
      hops: [
        checkRunHop("2026-07-25T13:00:00Z", "CI skipped (a) · PR #42"),
        checkRunHop("2026-07-25T13:00:01Z", "CI skipped (b) · PR #42"),
        checkRunHop("2026-07-25T13:00:02Z", "CI skipped (c) · PR #42"),
        checkRunHop("2026-07-25T13:30:00Z", "CI cancelled (d) · PR #42"),
        checkRunHop("2026-07-25T13:30:01Z", "CI cancelled (e) · PR #42"),
        checkRunHop("2026-07-25T13:30:02Z", "CI cancelled (f) · PR #42"),
      ],
    };
    const el = document.createElement("div");
    renderChains(el, [c]);
    const rows = el.querySelectorAll(".tl-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector(".tl-label")?.textContent).toBe("3 CI checks · 3 skipped");
    expect(rows[1]?.querySelector(".tl-label")?.textContent).toBe("3 CI checks · 3 cancelled");
    const gap = el.querySelector(".tl-gap");
    expect(gap).not.toBeNull();
    expect(gap?.textContent).toContain("later");
  });
});

describe("renderChains — name de-dup", () => {
  it("omits the .tl-droid tag when the label already opens with the droid's name", () => {
    const c: Chain = {
      pr: 1663,
      updated_at: "2026-07-25T14:00:00Z",
      active: false,
      complete: false,
      hops: [
        {
          at: "2026-07-25T13:00:00Z",
          droid: "hk-47",
          kind: "review_started",
          label: "HK-47 review started · PR #1663",
        },
      ],
    };
    const el = document.createElement("div");
    renderChains(el, [c]);
    const row = el.querySelector(".tl-row");
    expect(row?.querySelector(".tl-droid")).toBeNull();
    expect((row?.textContent?.match(/HK-47/g) ?? []).length).toBe(1);
  });

  it("keeps the .tl-droid tag when the label doesn't open with the droid's name", () => {
    const c: Chain = {
      pr: 1663,
      updated_at: "2026-07-25T14:00:00Z",
      active: false,
      complete: false,
      hops: [
        {
          at: "2026-07-25T13:00:00Z",
          droid: "hk-47",
          kind: "review_posted",
          label: "review CHANGES_REQUESTED · PR #1663",
        },
      ],
    };
    const el = document.createElement("div");
    renderChains(el, [c]);
    const row = el.querySelector(".tl-row");
    expect(row?.querySelector(".tl-droid")?.textContent).toBe("HK-47");
  });

  it("omits the tag case-insensitively (label 'copilot ...' vs registry name 'Copilot')", () => {
    const c: Chain = {
      pr: 42,
      updated_at: "2026-07-25T14:00:00Z",
      active: false,
      complete: false,
      hops: [
        {
          at: "2026-07-25T13:00:00Z",
          droid: "copilot",
          kind: "copilot_session_started",
          label: "copilot session started · PR #42",
        },
      ],
    };
    const el = document.createElement("div");
    renderChains(el, [c]);
    const row = el.querySelector(".tl-row");
    expect(row?.querySelector(".tl-droid")).toBeNull();
  });

  it("review_posted still keeps its tag (unaffected by the copilot case-insensitivity fix)", () => {
    const c: Chain = {
      pr: 42,
      updated_at: "2026-07-25T14:00:00Z",
      active: false,
      complete: false,
      hops: [
        {
          at: "2026-07-25T13:00:00Z",
          droid: "hk-47",
          kind: "review_posted",
          label: "review CHANGES_REQUESTED · PR #42",
        },
      ],
    };
    const el = document.createElement("div");
    renderChains(el, [c]);
    const row = el.querySelector(".tl-row");
    expect(row?.querySelector(".tl-droid")?.textContent).toBe("HK-47");
  });
});

// Accent sanity: the hk-47 accent used above really is a distinct color from
// the system dim neutral, so the "not equal" assertion above is meaningful.
describe("accent sanity", () => {
  it("hk-47's accent differs from the system dim neutral", () => {
    expect(ACCENTS["hk-47"]).not.toBe("#6b7789");
  });
});
