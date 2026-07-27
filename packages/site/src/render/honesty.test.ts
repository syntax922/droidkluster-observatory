import { describe, expect, it } from "vitest";
import { renderHonesty } from "./honesty.js";

const NOW = Date.parse("2026-07-25T14:00:41Z");

describe("renderHonesty", () => {
  it("live mode shows last-contact age", () => {
    const el = document.createElement("div");
    renderHonesty(el, { mode: "live", lastContact: "2026-07-25T14:00:29Z", nowMs: NOW });
    expect(el.textContent).toContain("telemetry: live");
    expect(el.textContent).toContain("12s ago");
  });
  it("stale mode names the gap", () => {
    const el = document.createElement("div");
    renderHonesty(el, { mode: "stale", lastContact: "2026-07-25T13:19:41Z", nowMs: NOW });
    expect(el.textContent).toContain("telemetry paused");
    expect(el.textContent).toContain("41m");
  });
  it("stale mode scales past the minute ceiling instead of counting forever in minutes", () => {
    // 3h before NOW: the old age() had no upper bound on minutes and would
    // have shown "180m ago" forever; humanAge scales this to "3h ago".
    const el = document.createElement("div");
    renderHonesty(el, { mode: "stale", lastContact: "2026-07-25T11:00:41Z", nowMs: NOW });
    expect(el.textContent).toContain("3h");
    expect(el.textContent).not.toContain("180m");
  });
  it("replay mode shows the replay label", () => {
    const el = document.createElement("div");
    renderHonesty(el, {
      mode: "replay",
      lastContact: "2026-07-25T14:00:29Z",
      nowMs: NOW,
      replayLabel: "REPLAY — PR #1607, 2026-07-23 (time ×30)",
    });
    expect(el.textContent).toContain("REPLAY — PR #1607");
  });
  it("idle mode names the honest no-replay-available state", () => {
    const el = document.createElement("div");
    renderHonesty(el, { mode: "idle", lastContact: "2026-07-25T13:19:41Z", nowMs: NOW });
    expect(el.textContent).toContain("fleet idle — no replay available");
    expect(el.textContent).toContain("41m");
    expect(el.dataset.mode).toBe("idle");
  });

  // Live production symptom: replay entered before any real poll had landed
  // left lastKnownContact at the new Date(0) placeholder, and the strip
  // rendered "REPLAY — PR #1663 · 2026-07-26 · 9h of history · live
  // telemetry last contact 20661d ago" — an honest-sounding but nonsensical
  // age derived from an epoch placeholder, not a real timestamp.
  it("replay mode names the epoch placeholder honestly instead of a huge day count", () => {
    const el = document.createElement("div");
    renderHonesty(el, {
      mode: "replay",
      lastContact: new Date(0).toISOString(),
      nowMs: NOW,
      replayLabel: "REPLAY — PR #1663 · 2026-07-26 · 9h of history",
    });
    expect(el.textContent).toBe(
      "REPLAY — PR #1663 · 2026-07-26 · 9h of history · no live telemetry yet",
    );
    expect(el.textContent).not.toContain("20661d");
    expect(el.textContent).not.toContain("ago");
  });

  it("idle mode names the epoch placeholder honestly instead of a huge day count", () => {
    const el = document.createElement("div");
    renderHonesty(el, { mode: "idle", lastContact: new Date(0).toISOString(), nowMs: NOW });
    expect(el.textContent).toBe("fleet idle — no replay available · no live telemetry yet");
    expect(el.dataset.mode).toBe("idle");
  });

  it("stale mode names the epoch placeholder honestly instead of a huge day count", () => {
    const el = document.createElement("div");
    renderHonesty(el, { mode: "stale", lastContact: new Date(0).toISOString(), nowMs: NOW });
    expect(el.textContent).toBe("telemetry paused — no live telemetry yet");
  });

  it("a lastContact just barely before the year-2000 cutoff still reads as unknown", () => {
    const el = document.createElement("div");
    renderHonesty(el, {
      mode: "idle",
      lastContact: "1999-12-31T23:59:59Z",
      nowMs: NOW,
    });
    expect(el.textContent).toContain("no live telemetry yet");
  });
});
