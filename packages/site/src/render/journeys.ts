import type { DroidId } from "@observatory/core";

export interface JourneyLane {
  pr: number;
  latest: string;
  droid: DroidId | "system";
  canvasKey: string;
}

// Canvas pitch is 3px per journey-frame pixel (matching dmd/painter.ts's
// PITCH), so JOURNEY_W*3 x JOURNEY_H*3.
const CANVAS_W = 576;
const CANVAS_H = 48;

const LEGEND_LABELS = ["OPENED", "REVIEW", "CI", "REWORK", "DECISION", "MERGED"];

function buildLane(lane: JourneyLane): HTMLDivElement {
  const laneEl = document.createElement("div");
  laneEl.className = "lane";
  laneEl.dataset.laneKey = lane.canvasKey;

  const head = document.createElement("div");
  head.className = "lane-head";
  laneEl.appendChild(head);

  const canvas = document.createElement("canvas");
  canvas.className = "lane-map";
  canvas.dataset.journey = lane.canvasKey;
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  canvas.setAttribute("aria-hidden", "true");
  laneEl.appendChild(canvas);

  return laneEl;
}

function updateHead(laneEl: HTMLDivElement, lane: JourneyLane): void {
  const head = laneEl.querySelector<HTMLElement>(".lane-head");
  if (!head) return;
  const text = `PR #${lane.pr} · ${lane.latest}`;
  head.textContent = text;
  head.title = text;
}

function buildLegend(): HTMLDivElement {
  const legend = document.createElement("div");
  legend.className = "lane-legend";
  for (const label of LEGEND_LABELS) {
    const item = document.createElement("span");
    item.textContent = label;
    legend.appendChild(item);
  }
  return legend;
}

// Renders one .lane per JourneyLane, reusing existing DOM nodes (crucially
// the <canvas>) when a lane's canvasKey is already present in `el` — the
// animation loop (journey-controller.ts) paints those canvases on its own
// clock, so replacing them wholesale on every poll would visibly stutter.
// Only the head text and DOM order are refreshed on reuse.
export function renderJourneys(el: HTMLElement, lanes: JourneyLane[]): void {
  if (lanes.length === 0) {
    el.replaceChildren();
    const p = document.createElement("p");
    p.className = "journeys-empty";
    p.textContent = "no journeys underway";
    el.appendChild(p);
    return;
  }

  if (el.querySelector(".journeys-empty")) el.replaceChildren();

  // Array.from (not spread/for-of) — NodeListOf isn't Iterable under this
  // project's DOM lib config, but it is array-like (see dmd/controller.ts).
  const existing = new Map<string, HTMLDivElement>();
  for (const laneEl of Array.from(el.querySelectorAll<HTMLDivElement>(".lane"))) {
    const key = laneEl.dataset.laneKey;
    if (key) existing.set(key, laneEl);
  }

  // The legend is rebuilt fresh under whichever lane ends up last — detach
  // it now so it doesn't get treated as a lane's trailing sibling below.
  el.querySelector(".lane-legend")?.remove();

  let prevEl: HTMLDivElement | null = null;
  for (const lane of lanes) {
    let laneEl = existing.get(lane.canvasKey);
    if (laneEl) {
      existing.delete(lane.canvasKey);
    } else {
      laneEl = buildLane(lane);
    }
    updateHead(laneEl, lane);

    const wantNext: Node | null = prevEl ? prevEl.nextSibling : el.firstChild;
    if (wantNext !== laneEl) el.insertBefore(laneEl, wantNext);
    prevEl = laneEl;
  }

  // Anything left in `existing` had a key from the previous render that
  // isn't in this one — drop it.
  for (const staleEl of existing.values()) staleEl.remove();

  if (prevEl) prevEl.after(buildLegend());
}
