import type { CurrentSnapshot, PublicEvent } from "@observatory/core";
import type { EdgeWriter } from "./edge.js";

export interface PushLoopOpts {
  enabled: boolean;
  writer: EdgeWriter;
  getSnapshot: () => CurrentSnapshot;
  getFeedDay: () => { key: string; events: PublicEvent[] };
  debounceMs: number;
  heartbeatMs: number;
  /**
   * Reports whether the upstream NATS connection is currently healthy.
   * Optional — when omitted, the heartbeat always pushes (back-compat for
   * callers that don't track connection health). Only the heartbeat consults
   * this; event-driven pushes (`markDirty`) imply health because they only
   * fire when a message was just consumed.
   */
  isHealthy?: () => boolean;
  log: (msg: string, extra?: object) => void;
}

export function startPushLoop(opts: PushLoopOpts): { markDirty: () => void; stop: () => void } {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function pushAll(includeFeed: boolean): Promise<void> {
    if (!opts.enabled || stopped) return;
    try {
      await opts.writer.putJson("current.json", opts.getSnapshot(), 15);
      if (includeFeed) {
        const day = opts.getFeedDay();
        await opts.writer.putJson(day.key, { events: day.events }, 60);
      }
    } catch (err) {
      opts.log("edge push failed", { err: err instanceof Error ? err.message : String(err) });
    }
  }

  const heartbeat = setInterval(() => {
    if (opts.isHealthy && !opts.isHealthy()) {
      opts.log("heartbeat skipped: nats unhealthy");
      return;
    }
    void pushAll(false);
  }, opts.heartbeatMs);

  return {
    markDirty: () => {
      if (!opts.enabled || stopped) return;
      if (debounceTimer) return; // window already open; coalesce
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void pushAll(true);
      }, opts.debounceMs);
    },
    stop: () => {
      stopped = true;
      clearInterval(heartbeat);
      if (debounceTimer) clearTimeout(debounceTimer);
    },
  };
}
