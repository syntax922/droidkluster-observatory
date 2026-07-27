import type { FleetState } from "./reduce.js";
import type { Chain, CurrentSnapshot, DroidId, DroidStatus } from "./schema.js";

export const ACTIVE_TTL_MIN = 15;
export const CHAIN_ACTIVE_WINDOW_MIN = 30;
export const SNAPSHOT_CHAINS_MAX = 6;

function minutesSince(iso: string | undefined, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return (now.getTime() - new Date(iso).getTime()) / 60_000;
}

export function toSnapshot(state: FleetState, now: Date): CurrentSnapshot {
  const droids: DroidStatus[] = (Object.keys(state.droids) as DroidId[]).map((id) => {
    const d = state.droids[id];
    const active = d.task !== undefined && minutesSince(d.since, now) <= ACTIVE_TTL_MIN;
    return {
      droid: id,
      state: active ? "active" : "idle",
      ...(active && d.task ? { task: d.task } : {}),
      ...(active && d.since ? { since: d.since } : {}),
      ...(d.last_action ? { last_action: d.last_action } : {}),
      ...(d.last_action_at ? { last_action_at: d.last_action_at } : {}),
    };
  });

  const chains: Chain[] = [...state.chains.values()]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, SNAPSHOT_CHAINS_MAX)
    .map((c) => ({
      pr: c.pr,
      hops: c.hops,
      updated_at: c.updated_at,
      active: !c.complete && minutesSince(c.updated_at, now) <= CHAIN_ACTIVE_WINDOW_MIN,
      complete: c.complete,
      // NOTE: c.events (internal capture log) is deliberately NOT copied.
    }));

  const nowIso = now.toISOString();
  return { generated_at: nowIso, last_contact: nowIso, droids, chains };
}
