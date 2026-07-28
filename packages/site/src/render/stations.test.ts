import { describe, expect, it } from "vitest";
import { renderStations } from "./stations.js";

const NOW = Date.parse("2026-07-25T14:02:00Z");

describe("renderStations", () => {
  it("renders one card per droid with active task and elapsed seconds", () => {
    const el = document.createElement("div");
    renderStations(
      el,
      [
        {
          droid: "hk-47",
          state: "active",
          task: "reviewing PR #1612",
          since: "2026-07-25T14:00:36Z",
        },
        { droid: "tt-8l", state: "idle", last_action: "merge decision APPROVED on PR #1600" },
      ],
      NOW,
    );
    const cards = el.querySelectorAll("[data-droid]");
    expect(cards).toHaveLength(2);
    const hk = el.querySelector('[data-droid="hk-47"]');
    expect(hk?.textContent).toContain("HK-47");
    expect(hk?.textContent).toContain("REVIEWING PR #1612");
    expect(hk?.textContent).toContain("84s");
    const tt = el.querySelector('[data-droid="tt-8l"]');
    expect(tt?.textContent).toContain("IDLE");
    expect(tt?.textContent).toContain("APPROVED");
  });

  it("renders r5 card with dispatching task", () => {
    const el = document.createElement("div");
    renderStations(
      el,
      [
        {
          droid: "r5",
          state: "active",
          task: "dispatching issue #128",
          since: "2026-07-25T14:01:30Z",
        },
      ],
      NOW,
    );
    const r5 = el.querySelector('[data-droid="r5"]');
    expect(r5?.textContent).toContain("R5");
    expect(r5?.textContent).toContain("Dispatch & rework routing");
    expect(r5?.textContent).toContain("DISPATCHING ISSUE #128");
  });

  it("copilot is not rendered as a station (UI-only removal)", () => {
    const el = document.createElement("div");
    renderStations(
      el,
      [
        { droid: "hk-47", state: "idle" },
        { droid: "copilot", state: "idle" },
      ],
      NOW,
    );
    expect(el.querySelectorAll(".station")).toHaveLength(1);
    expect(el.querySelector('[data-droid="copilot"]')).toBeNull();
  });
});
