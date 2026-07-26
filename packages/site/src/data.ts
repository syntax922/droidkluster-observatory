import {
  type CurrentSnapshot,
  CurrentSnapshotSchema,
  type ReplayBundle,
  ReplayBundleSchema,
  type ReplayIndex,
  ReplayIndexSchema,
} from "@observatory/core";

async function fetchParsed<T>(url: string, parse: (v: unknown) => T): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    return parse(await res.json());
  } catch {
    return null;
  }
}

export function fetchSnapshot(base: string): Promise<CurrentSnapshot | null> {
  return fetchParsed(`${base}/current.json`, (v) => CurrentSnapshotSchema.parse(v));
}
export function fetchReplayIndex(base: string): Promise<ReplayIndex | null> {
  return fetchParsed(`${base}/replays/index.json`, (v) => ReplayIndexSchema.parse(v));
}
export function fetchReplayBundle(base: string, id: string): Promise<ReplayBundle | null> {
  return fetchParsed(`${base}/replays/${id}.json`, (v) => ReplayBundleSchema.parse(v));
}

export interface PollingOpts {
  base: string;
  intervalMs: number;
  onSnapshot: (s: CurrentSnapshot) => void;
  onStale: (lastGood: CurrentSnapshot | null) => void;
}

export function startPolling(opts: PollingOpts): () => void {
  let lastGood: CurrentSnapshot | null = null;
  let stopped = false;

  async function poll(): Promise<void> {
    if (stopped) return;
    const snap = await fetchSnapshot(opts.base);
    if (snap) {
      lastGood = snap;
      opts.onSnapshot(snap);
    } else {
      opts.onStale(lastGood);
    }
  }

  void poll();
  const timer = setInterval(() => void poll(), opts.intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
