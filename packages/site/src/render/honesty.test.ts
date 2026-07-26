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
});
