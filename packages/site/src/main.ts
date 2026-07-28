import type { CurrentSnapshot, DroidId, PublicEvent } from "@observatory/core";
import { DroidIdSchema } from "@observatory/core";
import { createCelebrationTracker } from "./celebrate.js";
import { fetchReplayBundle, fetchReplayIndex, startPolling } from "./data.js";
import type { BoardView } from "./dmd/controller.js";
import { startDmd } from "./dmd/controller.js";
import { initIntro } from "./intro.js";
import type { LaneState } from "./journey-controller.js";
import { startJourneys } from "./journey-controller.js";
import { buildLiveLanes, buildReplayLane } from "./journey-lanes.js";
import { renderChains } from "./render/chains.js";
import { renderDossier } from "./render/dossier.js";
import { renderHonesty } from "./render/honesty.js";
import { renderJourneys } from "./render/journeys.js";
import { renderStations } from "./render/stations.js";
import { createReplayController } from "./replay-controller.js";
import { ReplayPlayer } from "./replay.js";
import { decideMode } from "./shell.js";
import "./style.css";

const DATA_BASE = import.meta.env.VITE_DATA_BASE ?? "https://data.whatis.droidkluster.com";
const POLL_MS = 20_000;

const els = {
  honesty: document.querySelector("#honesty") as HTMLElement,
  stations: document.querySelector("#stations") as HTMLElement,
  chains: document.querySelector("#chains") as HTMLElement,
  journeys: document.querySelector("#journeys") as HTMLElement,
  dossier: document.querySelector("#dossier") as HTMLElement,
  intro: document.querySelector("#intro") as HTMLElement,
  aboutToggle: document.querySelector("#about-toggle") as HTMLElement,
};

// Tracks the last known heartbeat so replay frames (which don't carry it —
// they render historical snapshots) can still report honest last-contact age.
let lastKnownContact = new Date(0).toISOString();

// Tracks the latest board state for the DMD controller's pull-based getBoard().
// Every render path (live/replay/stale/idle) updates this so the DMD stays in
// sync with whatever's on screen, even though it paints on its own clock.
let lastBoard: BoardView = {
  mode: "idle",
  droids: [],
  celebrating: false,
  renderedAtMs: Date.now(),
};

// Tracks the latest per-chain journey state for the journey controller's
// pull-based getLanes(). renderLive/onFrame set it fresh (dimmed: false);
// the stale/onStale/onIdle paths do NOT recompute it (there's no fresher
// chain data to recompute from) — they instead re-map the existing
// laneState to dimmed: true, so the journey controller freezes each lane's
// dot at its last position and renders it with the DMD "dim + motionless"
// idiom instead of implying live progress that isn't happening.
let laneState: LaneState[] = [];

// excerptsByPr for the LIVE feed, rebuilt each time the day's feed fetch
// resolves (see refreshExcerptsFromFeed). Keyed by PR, then by `${kind}|${at}`
// so the story rail can look up the excerpt for a specific hop.
let liveExcerptsByPr = new Map<number, Map<string, string>>();

function liveExcerptsFor(pr: number): Map<string, string> {
  return liveExcerptsByPr.get(pr) ?? new Map();
}

// Builds the `${kind}|${at}` -> excerpt lookup renderChains expects, scoped
// to a single feed of events (the live day-feed, or a replay's accumulated
// feed — each call site owns its own map so replay excerpts never leak into
// the live view or vice versa).
function buildExcerptsByPr(events: PublicEvent[]): Map<number, Map<string, string>> {
  const byPr = new Map<number, Map<string, string>>();
  for (const e of events) {
    if (e.pr === undefined || e.excerpt === undefined) continue;
    const forPr = byPr.get(e.pr) ?? new Map<string, string>();
    // `at` is second-precision, so two same-kind excerpts landing in the
    // same second on the same PR would collide here (last one wins). Only
    // review_posted carries an excerpt today, and only one reviewer posts
    // per PR at a time, so that collision doesn't happen in practice.
    forPr.set(`${e.kind}|${e.at}`, e.excerpt);
    byPr.set(e.pr, forPr);
  }
  return byPr;
}

// Edge-triggered celebration: the trigger is the OBSERVED merge event (a
// pr_merged hop newer than any previously seen), not an age window on "now".
// An age window either never lands (live polling can miss the merge while
// it's still inside the window — pipeline latency is commonly 15-30s, well
// past a 10s window) or stays sticky too long in replay (every frame within
// the window re-derives celebrating=true independent of whether the merge
// was already shown, and replay time-compression shrinks the window
// unpredictably). Tracking real display-clock elapsed time instead means:
// first time we observe a given merge, start a fixed 3s wall-clock countdown
// — identical behavior live and in replay, because the trigger is "have we
// rendered a merge this new before", and the duration is real elapsed time,
// not a comparison against the snapshot's own clock. See celebrate.ts.
const celebration = createCelebrationTracker();

function renderLive(snap: CurrentSnapshot): void {
  const now = Date.now();
  renderStations(els.stations, snap.droids, now);
  renderChains(els.chains, snap.chains, liveExcerptsFor);
  const { lanes, states } = buildLiveLanes(snap.chains);
  renderJourneys(els.journeys, lanes);
  laneState = states;
  renderHonesty(els.honesty, { mode: "live", lastContact: snap.last_contact, nowMs: now });
  lastBoard = {
    mode: "live",
    droids: snap.droids,
    celebrating: celebration.observe(snap.chains),
    renderedAtMs: now,
  };
}

async function refreshExcerptsFromFeed(): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch(`${DATA_BASE}/feed/${day}.json`, { cache: "no-cache" });
    if (res.ok) {
      const body = (await res.json()) as { events?: PublicEvent[] };
      if (Array.isArray(body.events)) {
        liveExcerptsByPr = buildExcerptsByPr(body.events);
      }
    }
  } catch {
    /* keep last known excerpts */
  }
}

const replay = createReplayController({
  fetchIndex: () => fetchReplayIndex(DATA_BASE),
  fetchBundle: (id) => fetchReplayBundle(DATA_BASE, id),
  makePlayer: (bundle, opts) => new ReplayPlayer(bundle, opts),
  onFrame: (snap, feed, label) => {
    const replayNow = Date.parse(snap.generated_at);
    const replayExcerptsByPr = buildExcerptsByPr(feed);
    renderStations(els.stations, snap.droids, replayNow);
    renderChains(els.chains, snap.chains, (pr) => replayExcerptsByPr.get(pr) ?? new Map());
    const built = buildReplayLane(feed);
    renderJourneys(els.journeys, built ? [built.lane] : []);
    laneState = built ? [built.state] : [];
    renderHonesty(els.honesty, {
      mode: "replay",
      lastContact: lastKnownContact,
      nowMs: Date.now(),
      replayLabel: label,
    });
    lastBoard = {
      mode: "replay",
      droids: snap.droids,
      celebrating: celebration.observe(snap.chains),
      renderedAtMs: replayNow,
    };
  },
  onIdle: (lastContact) => {
    // No curated replays available: say so plainly rather than leaving a
    // stale live/replay render standing silently.
    renderHonesty(els.honesty, { mode: "idle", lastContact, nowMs: Date.now() });
    lastBoard = {
      mode: "idle",
      droids: lastBoard.droids,
      celebrating: false,
      renderedAtMs: lastBoard.renderedAtMs,
    };
    laneState = laneState.map((s) => ({ ...s, dimmed: true }));
  },
});

// Deploy stamp: inspectable in devtools, and guarantees each deploy re-hashes
// the bundle past any edge-cached artifact of the previous one.
document.documentElement.dataset.build = "2026-07-27";

initIntro({
  root: els.intro,
  toggle: els.aboutToggle,
  storage: localStorage,
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
});

startDmd({ root: els.stations, getBoard: () => lastBoard });
startJourneys({ root: els.journeys, getLanes: () => laneState });

startPolling({
  base: DATA_BASE,
  intervalMs: POLL_MS,
  onSnapshot: async (snap) => {
    const mode = decideMode(snap, Date.now());
    if (mode === "live") {
      replay.exit();
      // Same-edge and fast: resolve the feed (and its excerpts) before
      // painting, so a newly-arrived excerpt-bearing hop renders its quote
      // card on this snapshot instead of waiting for the next ~20s poll.
      // The catch keeps a feed failure from blocking the board render.
      await refreshExcerptsFromFeed().catch(() => {});
      renderLive(snap);
    } else if (mode === "stale") {
      replay.exit();
      renderHonesty(els.honesty, {
        mode: "stale",
        lastContact: snap.last_contact,
        nowMs: Date.now(),
      });
      lastBoard = {
        mode: "stale",
        droids: lastBoard.droids,
        celebrating: false,
        renderedAtMs: lastBoard.renderedAtMs,
      };
      laneState = laneState.map((s) => ({ ...s, dimmed: true }));
    } else {
      lastKnownContact = snap.last_contact;
      void replay.enter(snap.last_contact);
    }
  },
  onStale: (lastGood) => {
    if (lastGood) {
      renderHonesty(els.honesty, {
        mode: "stale",
        lastContact: lastGood.last_contact,
        nowMs: Date.now(),
      });
      lastBoard = {
        mode: "stale",
        droids: lastBoard.droids,
        celebrating: false,
        renderedAtMs: lastBoard.renderedAtMs,
      };
      laneState = laneState.map((s) => ({ ...s, dimmed: true }));
    }
    lastKnownContact = lastGood?.last_contact ?? new Date(0).toISOString();
    void replay.enter(lastKnownContact);
  },
});

els.stations.addEventListener("click", (ev) => {
  const card = (ev.target as HTMLElement).closest("[data-droid]");
  const parsed = DroidIdSchema.safeParse(card?.getAttribute("data-droid"));
  if (!parsed.success) return;
  const droid: DroidId = parsed.data;
  renderDossier(els.dossier, droid);
  els.dossier.hidden = false;
});
els.dossier.addEventListener("click", () => {
  els.dossier.hidden = true;
});
