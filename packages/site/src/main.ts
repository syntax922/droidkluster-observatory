import type { CurrentSnapshot, DroidId, PublicEvent, ReplayBundle } from "@observatory/core";
import { DroidIdSchema } from "@observatory/core";
import { fetchReplayBundle, fetchReplayIndex, startPolling } from "./data.js";
import { renderChains } from "./render/chains.js";
import { renderDossier } from "./render/dossier.js";
import { renderHonesty } from "./render/honesty.js";
import { renderStations } from "./render/stations.js";
import { renderTicker } from "./render/ticker.js";
import { ReplayPlayer, pickCompression, replayLabel } from "./replay.js";
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

let player: ReplayPlayer | null = null;
let replayIds: string[] = [];
let replayCursor = 0;

function renderLive(snap: CurrentSnapshot): void {
  const now = Date.now();
  renderStations(els.stations, snap.droids, now);
  renderChains(els.chains, snap.chains);
  renderHonesty(els.honesty, { mode: "live", lastContact: snap.last_contact, nowMs: now });
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

async function enterReplay(lastContact: string): Promise<void> {
  if (player) return; // already replaying
  if (replayIds.length === 0) {
    const index = await fetchReplayIndex(DATA_BASE);
    replayIds = index?.replays.map((r) => r.id) ?? [];
  }
  const id = replayIds[replayCursor % Math.max(1, replayIds.length)];
  if (!id) return; // no curated replays yet: board stays on last live render
  replayCursor += 1;
  const bundle: ReplayBundle | null = await fetchReplayBundle(DATA_BASE, id);
  if (!bundle) return;
  const compression = pickCompression(bundle);
  player = new ReplayPlayer(bundle, {
    compression,
    onFrame: (snap, feed, label) => {
      renderStations(els.stations, snap.droids, Date.parse(snap.generated_at));
      renderChains(els.chains, snap.chains);
      renderTicker(els.ticker, feed);
      renderHonesty(els.honesty, {
        mode: "replay",
        lastContact,
        nowMs: Date.now(),
        replayLabel: label,
      });
    },
    onDone: () => {
      player = null; // next tick picks the next bundle (or live preempts)
    },
  });
  player.start();
}

function exitReplay(): void {
  player?.stop();
  player = null;
}

startPolling({
  base: DATA_BASE,
  intervalMs: POLL_MS,
  onSnapshot: (snap) => {
    const mode = decideMode(snap, Date.now());
    if (mode === "live") {
      exitReplay();
      renderLive(snap);
      void refreshTickerFromFeed();
    } else if (mode === "stale") {
      exitReplay();
      renderHonesty(els.honesty, {
        mode: "stale",
        lastContact: snap.last_contact,
        nowMs: Date.now(),
      });
    } else {
      void enterReplay(snap.last_contact);
    }
  },
  onStale: (lastGood) => {
    if (lastGood) {
      renderHonesty(els.honesty, {
        mode: "stale",
        lastContact: lastGood.last_contact,
        nowMs: Date.now(),
      });
    }
    void enterReplay(lastGood?.last_contact ?? new Date(0).toISOString());
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
