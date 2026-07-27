import { humanAge } from "../time.js";

export interface HonestyOpts {
  mode: "live" | "stale" | "replay" | "idle";
  lastContact: string;
  nowMs: number;
  replayLabel?: string;
}

// `new Date(0).toISOString()` is the codebase's placeholder for "we have
// never actually heard from the fleet" (main.ts's lastKnownContact starts
// here, and stays here through a replay/idle transition that happens before
// any real poll has landed). Any lastContact at or near the epoch is that
// placeholder, not a real timestamp — humanizing it as an age produces an
// absurd "20661d ago" instead of an honest "we don't know yet". Year 2000 is
// a generous cutoff: no real fleet contact will ever predate this codebase.
const UNKNOWN_CONTACT_CUTOFF_MS = Date.parse("2000-01-01T00:00:00Z");

function isUnknownContact(iso: string): boolean {
  const t = Date.parse(iso);
  return Number.isNaN(t) || t < UNKNOWN_CONTACT_CUTOFF_MS;
}

function age(iso: string, nowMs: number): string {
  return `${humanAge(nowMs - Date.parse(iso))} ago`;
}

// Renders the honest "since when" fragment shared by the non-live text
// variants: a real age when lastContact is a real timestamp, or a plain
// admission of "no live telemetry yet" when it's the epoch placeholder.
// Keeping this one function is what makes replay/idle/stale treat "unknown"
// uniformly instead of each mode growing its own epoch special-case.
function contactFragment(lastContact: string, nowMs: number, knownPrefix: string): string {
  return isUnknownContact(lastContact)
    ? "no live telemetry yet"
    : `${knownPrefix}${age(lastContact, nowMs)}`;
}

export function renderHonesty(el: HTMLElement, opts: HonestyOpts): void {
  if (opts.mode === "live") {
    el.textContent = `telemetry: live · last contact ${age(opts.lastContact, opts.nowMs)}`;
    el.dataset.mode = "live";
  } else if (opts.mode === "stale") {
    el.textContent = `telemetry paused — ${contactFragment(opts.lastContact, opts.nowMs, "last contact ")}`;
    el.dataset.mode = "stale";
  } else if (opts.mode === "idle") {
    el.textContent = `fleet idle — no replay available · ${contactFragment(opts.lastContact, opts.nowMs, "last contact ")}`;
    el.dataset.mode = "idle";
  } else {
    el.textContent = `${opts.replayLabel ?? "REPLAY"} · ${contactFragment(opts.lastContact, opts.nowMs, "live telemetry last contact ")}`;
    el.dataset.mode = "replay";
  }
}
