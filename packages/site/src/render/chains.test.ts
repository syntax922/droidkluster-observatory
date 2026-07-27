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

// Accent sanity: the hk-47 accent used above really is a distinct color from
// the system dim neutral, so the "not equal" assertion above is meaningful.
describe("accent sanity", () => {
  it("hk-47's accent differs from the system dim neutral", () => {
    expect(ACCENTS["hk-47"]).not.toBe("#6b7789");
  });
});
