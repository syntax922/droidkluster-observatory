import type { Chain, DroidId, PublicEvent } from "@observatory/core";
import { chainStage, STAGES, type Stage, stageOf } from "./journey.js";
import type { LaneState } from "./journey-controller.js";
import type { JourneyLane } from "./render/journeys.js";

// Caps how many chains get their own lane on the live journey map — more
// than a handful of simultaneous lanes stops being a spatial "where is it"
// view and turns back into a scrolling list, which is the exact problem
// this replaces the ticker to solve.
export const LIVE_LANE_CAP = 4;

export function visitedStages(hopKinds: Iterable<PublicEvent["kind"]>): boolean[] {
  const visited = STAGES.map(() => false);
  for (const kind of hopKinds) {
    const stage = stageOf(kind);
    if (stage) visited[STAGES.indexOf(stage)] = true;
  }
  return visited;
}

// Builds both the DOM-facing lanes (render/journeys.ts) and the
// controller-facing lane states (journey-controller.ts) from the same
// ordered chain list, sharing a `pr-${pr}` key between the two so the
// controller's canvas lookup lines up with what renderJourneys just drew.
// Lanes built here always come from fresh live telemetry, so dimmed is
// always false — main.ts is solely responsible for dimming lanes on its
// stale/idle paths (see the laneState comment there).
export function buildLiveLanes(chains: Chain[]): { lanes: JourneyLane[]; states: LaneState[] } {
  const ordered = [...chains].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const lanes: JourneyLane[] = [];
  const states: LaneState[] = [];
  for (const c of ordered.slice(0, LIVE_LANE_CAP)) {
    const { stage, droid } = chainStage(c);
    const key = `pr-${c.pr}`;
    const latest = c.hops[c.hops.length - 1]?.label ?? "opened";
    lanes.push({ pr: c.pr, latest, droid, canvasKey: key });
    states.push({
      key,
      stageIndex: STAGES.indexOf(stage),
      visited: visitedStages(c.hops.map((h) => h.kind)),
      droid,
      dimmed: false,
    });
  }
  return { lanes, states };
}

// Replay's onFrame only carries the flat feed of PublicEvents seen so far
// (not a Chain), so this mirrors chainStage()'s "last hop with a non-null
// stage wins" rule directly over that feed instead.
//
// The feed's newest event doesn't always carry a `.pr` — an
// issue_dispatched event (dispatch precedes PR existence) has none. Trusting
// feed[last].pr blindly would fabricate "PR #0" and, on the next frame where
// a later event DOES carry a pr again, churn the lane's canvasKey for no
// reason. Instead this backward-scans for the last event that actually
// carries a pr, mirroring the existing backward-scan for stage/droid below.
// If the feed has no pr-bearing event yet (e.g. still only issue events),
// there's nothing to show a journey for — the caller renders the empty
// state rather than a fabricated lane.
export function buildReplayLane(
  feed: PublicEvent[],
): { lane: JourneyLane; state: LaneState } | null {
  let pr: number | undefined;
  for (let i = feed.length - 1; i >= 0; i--) {
    const p = feed[i]?.pr;
    if (p !== undefined) {
      pr = p;
      break;
    }
  }
  if (pr === undefined) return null;

  const key = `replay-${pr}`;
  let stage: Stage = "opened";
  let droid: DroidId | "system" = "system";
  for (let i = feed.length - 1; i >= 0; i--) {
    const e = feed[i];
    const s = e ? stageOf(e.kind) : null;
    if (e && s) {
      stage = s;
      droid = e.droid;
      break;
    }
  }
  const latest = feed[feed.length - 1]?.summary ?? "opened";
  return {
    lane: { pr, latest, droid, canvasKey: key },
    state: {
      key,
      stageIndex: STAGES.indexOf(stage),
      visited: visitedStages(feed.map((e) => e.kind)),
      droid,
      dimmed: false,
    },
  };
}
