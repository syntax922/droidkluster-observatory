// Humanized time helpers for the timeline story rail and the honesty strip.
// A single scaling ladder (s -> m -> h -> d) so every place in the UI that
// names an age or a span agrees on the same boundaries.

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const SECONDS_CEILING_MS = 90 * SECOND_MS;
const MINUTES_CEILING_MS = 90 * MINUTE_MS;
const HOURS_CEILING_MS = 36 * HOUR_MS;

// Rounds ms into the coarsest unit that still reads as "at a glance": under
// 90s show seconds, under 90m show minutes, under 36h show hours, else days.
// Negative durations (clock skew, replay frames arriving slightly out of
// order) clamp to "0s" rather than surfacing a confusing "-3s".
export function humanAge(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < SECONDS_CEILING_MS) return `${Math.round(clamped / SECOND_MS)}s`;
  if (clamped < MINUTES_CEILING_MS) return `${Math.round(clamped / MINUTE_MS)}m`;
  if (clamped < HOURS_CEILING_MS) return `${Math.round(clamped / HOUR_MS)}h`;
  return `${Math.round(clamped / DAY_MS)}d`;
}

// "+3m" style offset from a chain/replay's first timestamp — the story
// rail's clock, not wall-clock "ago".
export function offsetLabel(startIso: string, atIso: string): string {
  return `+${humanAge(Date.parse(atIso) - Date.parse(startIso))}`;
}

// Humanized span between two timestamps (e.g. a replay's total duration).
export function spanLabel(firstIso: string, lastIso: string): string {
  return humanAge(Date.parse(lastIso) - Date.parse(firstIso));
}
