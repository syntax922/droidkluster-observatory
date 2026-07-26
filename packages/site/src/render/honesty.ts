export interface HonestyOpts {
  mode: "live" | "stale" | "replay" | "idle";
  lastContact: string;
  nowMs: number;
  replayLabel?: string;
}

function age(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 90) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
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
