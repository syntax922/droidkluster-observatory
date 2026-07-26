import type { Chain, CurrentSnapshot, DroidId, PublicEvent } from "@observatory/core";
import { DroidIdSchema } from "@observatory/core";
import { fetchReplayBundle, fetchReplayIndex, startPolling } from "./data.js";
import type { BoardView } from "./dmd/controller.js";
import { startDmd } from "./dmd/controller.js";
import { renderChains } from "./render/chains.js";
import { renderDossier } from "./render/dossier.js";
import { renderHonesty } from "./render/honesty.js";
import { renderStations } from "./render/stations.js";
import { renderTicker } from "./render/ticker.js";
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
  ticker: document.querySelector("#ticker") as HTMLElement,
  dossier: document.querySelector("#dossier") as HTMLElement,
};

// Tracks the last known heartbeat so replay frames (which don't carry it —
// they render historical snapshots) can still report honest last-contact age.
let lastKnownContact = new Date(0).toISOString();

// Tracks the latest board state for the DMD controller's pull-based getBoard().
// Every render path (live/replay/stale/idle) updates this so the DMD stays in
// sync with whatever's on screen, even though it paints on its own clock.
let lastBoard: BoardView = { mode: "idle", droids: [], celebrating: false };

const CELEBRATE_WINDOW_MS = 10_000;

// A chain hop of kind pr_merged within the last 10s of the snapshot's own
// "now" (wall-clock for live, generated_at for replay) triggers the
// celebration glyph across the board.
function isCelebrating(chains: Chain[], nowMs: number): boolean {
  for (const chain of chains) {
    for (const hop of chain.hops) {
      if (hop.kind !== "pr_merged") continue;
      const age = nowMs - Date.parse(hop.at);
      if (age >= 0 && age <= CELEBRATE_WINDOW_MS) return true;
    }
  }
  return false;
}

function renderLive(snap: CurrentSnapshot): void {
  const now = Date.now();
  renderStations(els.stations, snap.droids, now);
  renderChains(els.chains, snap.chains);
  renderHonesty(els.honesty, { mode: "live", lastContact: snap.last_contact, nowMs: now });
  lastBoard = { mode: "live", droids: snap.droids, celebrating: isCelebrating(snap.chains, now) };
}

async function refreshTickerFromFeed(): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch(`${DATA_BASE}/feed/${day}.json`, { cache: "no-cache" });
    if (res.ok) {
      const body = (await res.json()) as { events?: PublicEvent[] };
      if (Array.isArray(body.events)) renderTicker(els.ticker, body.events);
    }
  } catch {
    /* keep last ticker */
  }
}

const replay = createReplayController({
  fetchIndex: () => fetchReplayIndex(DATA_BASE),
  fetchBundle: (id) => fetchReplayBundle(DATA_BASE, id),
  makePlayer: (bundle, opts) => new ReplayPlayer(bundle, opts),
  onFrame: (snap, feed, label) => {
    const replayNow = Date.parse(snap.generated_at);
    renderStations(els.stations, snap.droids, replayNow);
    renderChains(els.chains, snap.chains);
    renderTicker(els.ticker, feed);
    renderHonesty(els.honesty, {
      mode: "replay",
      lastContact: lastKnownContact,
      nowMs: Date.now(),
      replayLabel: label,
    });
    lastBoard = {
      mode: "replay",
      droids: snap.droids,
      celebrating: isCelebrating(snap.chains, replayNow),
    };
  },
  onIdle: (lastContact) => {
    // No curated replays available: say so plainly rather than leaving a
    // stale live/replay render standing silently.
    renderHonesty(els.honesty, { mode: "idle", lastContact, nowMs: Date.now() });
    lastBoard = { mode: "idle", droids: lastBoard.droids, celebrating: false };
  },
});

startDmd({ root: els.stations, getBoard: () => lastBoard });

startPolling({
  base: DATA_BASE,
  intervalMs: POLL_MS,
  onSnapshot: (snap) => {
    const mode = decideMode(snap, Date.now());
    if (mode === "live") {
      replay.exit();
      renderLive(snap);
      void refreshTickerFromFeed();
    } else if (mode === "stale") {
      replay.exit();
      renderHonesty(els.honesty, {
        mode: "stale",
        lastContact: snap.last_contact,
        nowMs: Date.now(),
      });
      lastBoard = { mode: "stale", droids: lastBoard.droids, celebrating: false };
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
      lastBoard = { mode: "stale", droids: lastBoard.droids, celebrating: false };
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
