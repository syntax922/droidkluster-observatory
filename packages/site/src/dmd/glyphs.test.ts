import { describe, expect, it } from "vitest";
import { DMD_W, blank } from "./frame.js";
import { dmdFrame } from "./glyphs.js";

describe("shared DMD states", () => {
  it("is deterministic in tMs", () => {
    expect(dmdFrame("hk-47", "idle", 1234)).toEqual(dmdFrame("hk-47", "idle", 1234));
  });
  it("idle breathes — frames differ across the cycle and stay dim", () => {
    const a = dmdFrame("r5", "idle", 0);
    const b = dmdFrame("r5", "idle", 900);
    expect(a).not.toEqual(b);
    expect(Math.max(...a)).toBeLessThanOrEqual(2); // idle never hits full brightness
  });
  it("stale static is deterministic per time-bucket and changes across buckets", () => {
    expect(dmdFrame("tt-8l", "stale", 100)).toEqual(dmdFrame("tt-8l", "stale", 119)); // same 120ms bucket
    expect(dmdFrame("tt-8l", "stale", 100)).not.toEqual(dmdFrame("tt-8l", "stale", 250));
  });
  it("celebrate expands rings from center over time", () => {
    const early = dmdFrame("2-1b", "celebrate", 80);
    const late = dmdFrame("2-1b", "celebrate", 800);
    expect(early).not.toEqual(late);
    expect(Math.max(...late)).toBe(3);
  });
  it("never exceeds intensity 3 and never writes out of bounds", () => {
    for (const t of [0, 333, 1000, 5000]) {
      const f = dmdFrame("ev-9d9", "celebrate", t);
      expect(f.length).toBe(64 * 32);
      expect(Math.max(...f)).toBeLessThanOrEqual(3);
    }
  });
});
