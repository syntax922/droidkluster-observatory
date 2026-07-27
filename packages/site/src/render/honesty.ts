import { humanAge } from "../time.js";

export interface HonestyOpts {
  mode: "live" | "stale" | "replay" | "idle";
  lastContact: string;
  nowMs: number;
  replayLabel?: string;
}

function age(iso: string, nowMs: number): string {
  return `${humanAge(nowMs - Date.parse(iso))} ago`;
}

export function renderHonesty(el: HTMLElement, opts: HonestyOpts): void {
  const a = age(opts.lastContact, opts.nowMs);
  if (opts.mode === "live") {
    el.textContent = `telemetry: live · last contact ${a}`;
    el.dataset.mode = "live";
  } else if (opts.mode === "stale") {
    el.textContent = `telemetry paused — last contact ${a}`;
    el.dataset.mode = "stale";
  } else if (opts.mode === "idle") {
    el.textContent = `fleet idle — no replay available · last contact ${a}`;
    el.dataset.mode = "idle";
  } else {
    el.textContent = `${opts.replayLabel ?? "REPLAY"} · live telemetry last contact ${a}`;
    el.dataset.mode = "replay";
  }
}
