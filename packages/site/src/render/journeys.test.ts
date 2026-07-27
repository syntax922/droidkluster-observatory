import { describe, expect, it } from "vitest";
import { type JourneyLane, renderJourneys } from "./journeys.js";

const lanes: JourneyLane[] = [
  { pr: 42, latest: "review started", droid: "hk-47", canvasKey: "pr-42" },
  { pr: 7, latest: "CI red (lint)", droid: "2-1b", canvasKey: "pr-7" },
];

describe("renderJourneys", () => {
  it("renders one .lane per lane, with a head and a canvas each", () => {
    const el = document.createElement("div");
    renderJourneys(el, lanes);
    const laneEls = el.querySelectorAll(".lane");
    expect(laneEls.length).toBe(2);
    expect(laneEls[0]?.querySelector(".lane-head")?.textContent).toContain("PR #42");
    expect(laneEls[0]?.querySelector(".lane-head")?.textContent).toContain("review started");
    expect(laneEls[0]?.querySelector("canvas.lane-map")?.getAttribute("data-journey")).toBe(
      "pr-42",
    );
    expect(laneEls[1]?.querySelector(".lane-head")?.textContent).toContain("PR #7");
  });

  it("puts the legend under the last lane only", () => {
    const el = document.createElement("div");
    renderJourneys(el, lanes);
    const legends = el.querySelectorAll(".lane-legend");
    expect(legends.length).toBe(1);
    expect(legends[0]?.previousElementSibling?.getAttribute("data-lane-key")).toBe("pr-7");
  });

  it("reuses lane/canvas DOM nodes across renders when keys are unchanged", () => {
    const el = document.createElement("div");
    renderJourneys(el, lanes);
    const canvasBefore = el.querySelector('canvas[data-journey="pr-42"]');
    const laneBefore = el.querySelector('.lane[data-lane-key="pr-42"]');

    renderJourneys(el, [
      { pr: 42, latest: "review posted", droid: "hk-47", canvasKey: "pr-42" },
      { pr: 7, latest: "CI green (lint)", droid: "2-1b", canvasKey: "pr-7" },
    ]);

    const canvasAfter = el.querySelector('canvas[data-journey="pr-42"]');
    const laneAfter = el.querySelector('.lane[data-lane-key="pr-42"]');
    expect(canvasAfter).toBe(canvasBefore); // same canvas element identity — no churn
    expect(laneAfter).toBe(laneBefore);
    expect(laneAfter?.querySelector(".lane-head")?.textContent).toContain("review posted");
  });

  it("drops a lane whose key disappears and adds a new one", () => {
    const el = document.createElement("div");
    renderJourneys(el, lanes);
    renderJourneys(el, [{ pr: 99, latest: "opened", droid: "system", canvasKey: "pr-99" }]);
    expect(el.querySelectorAll(".lane").length).toBe(1);
    expect(el.querySelector('.lane[data-lane-key="pr-99"]')).not.toBeNull();
    expect(el.querySelector('.lane[data-lane-key="pr-42"]')).toBeNull();
  });

  it("shows the empty state when there are no lanes", () => {
    const el = document.createElement("div");
    renderJourneys(el, []);
    expect(el.querySelector(".journeys-empty")?.textContent).toBe("no journeys underway");
    expect(el.querySelectorAll(".lane").length).toBe(0);
  });

  it("recovers from the empty state once lanes appear again", () => {
    const el = document.createElement("div");
    renderJourneys(el, []);
    renderJourneys(el, lanes);
    expect(el.querySelector(".journeys-empty")).toBeNull();
    expect(el.querySelectorAll(".lane").length).toBe(2);
  });
});
