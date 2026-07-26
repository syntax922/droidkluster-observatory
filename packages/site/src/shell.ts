import type { CurrentSnapshot } from "@observatory/core";

export const IDLE_REPLAY_AFTER_MIN = 10;
export const STALE_AFTER_MIN = 5;

export type BoardMode = "live" | "replay" | "stale";

export function decideMode(snap: CurrentSnapshot, nowMs: number): BoardMode {
  const contactAgeMin = (nowMs - Date.parse(snap.last_contact)) / 60_000;
  if (contactAgeMin > STALE_AFTER_MIN) return "stale";
  const newestActivity = snap.chains.reduce((max, c) => Math.max(max, Date.parse(c.updated_at)), 0);
  const anyActive = snap.chains.some((c) => c.active);
  const quietMin = (nowMs - newestActivity) / 60_000;
  if (anyActive && quietMin <= IDLE_REPLAY_AFTER_MIN) return "live";
  return "replay";
}
