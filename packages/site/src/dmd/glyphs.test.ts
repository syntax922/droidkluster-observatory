import { describe, expect, it } from "vitest";
import { DMD_W, blank } from "./frame.js";
import { type DmdState, type GlyphCounts, dmdFrame, standbyGlyphs } from "./glyphs.js";

const DROIDS = ["hk-47", "2-1b", "tt-8l", "ev-9d9", "r5", "copilot"] as const;

describe("shared DMD states", () => {
  it("is deterministic in tMs", () => {
    expect(dmdFrame("hk-47", "idle", 1234)).toEqual(dmdFrame("hk-47", "idle", 1234));
  });
  it("idle breathes — frames differ across the cycle and stay dim", () => {
    // r5's standby signature (see "standby glyphs" below) breathes on a 5s
    // cosine, so 0 vs its half-period (2500ms) is the delta guaranteed to
    // land on different rounded intensity levels.
    const a = dmdFrame("r5", "idle", 0);
    const b = dmdFrame("r5", "idle", 2500);
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

describe("active glyphs", () => {
  it("every droid has a dedicated active glyph (no idle fallback)", () => {
    for (const d of DROIDS) {
      expect(dmdFrame(d, "active", 500)).not.toEqual(dmdFrame(d, "idle", 500));
    }
  });
  it("active glyphs animate (frames differ across time)", () => {
    for (const d of DROIDS) {
      expect(dmdFrame(d, "active", 0)).not.toEqual(dmdFrame(d, "active", 700));
    }
  });
  it("hk-47 scanline: exactly one full-brightness row inside the document sweeps over time", () => {
    const rowAt = (t: number) => {
      const f = dmdFrame("hk-47", "active", t);
      for (let y = 5; y < 27; y++) if (f[y * 64 + 24] === 3) return y;
      return -1;
    };
    expect(rowAt(0)).toBeGreaterThanOrEqual(5);
    expect(rowAt(0)).not.toBe(rowAt(1100));
  });
  it("all active glyphs stay in bounds and <= 3 across a full cycle", () => {
    for (const d of DROIDS)
      for (const t of [0, 250, 500, 1000, 2000, 4000]) {
        const f = dmdFrame(d, "active", t);
        expect(f.length).toBe(64 * 32);
        expect(Math.max(...f)).toBeLessThanOrEqual(3);
      }
  });
});

// The fix for "the fleet looks linear": every droid gets its own dim, slow,
// recognizable-at-rest signature instead of sharing one anonymous breathing
// lattice — so six idle stations read as six distinct machines, not five
// placeholders around one active pipeline stage.
describe("standby glyphs", () => {
  it("every droid is pairwise distinct from every other droid at a fixed t", () => {
    for (const dA of DROIDS) {
      for (const dB of DROIDS) {
        if (dA === dB) continue;
        expect(dmdFrame(dA, "idle", 1200)).not.toEqual(dmdFrame(dB, "idle", 1200));
      }
    }
  });
  it("every droid's standby differs from its own active glyph", () => {
    for (const d of DROIDS) {
      expect(dmdFrame(d, "idle", 1200)).not.toEqual(dmdFrame(d, "active", 1200));
    }
  });
  it("stays at or below intensity 2 — standby never reads as active", () => {
    for (const d of DROIDS)
      for (const t of [0, 833, 1666, 2500, 4000, 5500]) {
        expect(Math.max(...standbyGlyphs[d](t))).toBeLessThanOrEqual(2);
      }
  });
  it("animates: t=0 differs from t=2500 for every droid", () => {
    for (const d of DROIDS) {
      expect(dmdFrame(d, "idle", 0)).not.toEqual(dmdFrame(d, "idle", 2500));
    }
  });
  it("is deterministic in tMs", () => {
    for (const d of DROIDS) {
      expect(dmdFrame(d, "idle", 4321)).toEqual(dmdFrame(d, "idle", 4321));
    }
  });
  it("hk-47 standby has no scanline (no intensity-3 pixel anywhere)", () => {
    for (const t of [0, 1000, 2500, 4000]) {
      expect(dmdFrame("hk-47", "idle", t).includes(3)).toBe(false);
    }
  });
  it("tt-8l standby is the shipping belt at rest (no gate bars)", () => {
    const f = dmdFrame("tt-8l", "idle", 0);
    // Belt runs the full width at y=22; the old gate bars around x=27/x=36
    // are gone.
    expect(f[22 * 64 + 4]).toBeGreaterThan(0);
    expect(f[22 * 64 + 59]).toBeGreaterThan(0);
  });
  it("all standby glyphs stay in bounds across a full cycle", () => {
    for (const d of DROIDS)
      for (const t of [0, 250, 500, 1000, 2000, 4000, 6000]) {
        const f = dmdFrame(d, "idle", t);
        expect(f.length).toBe(64 * 32);
        expect(Math.max(...f)).toBeLessThanOrEqual(2);
      }
  });
});

describe("cooling", () => {
  it("lifts every nonzero standby pixel by 1, capped at 3", () => {
    for (const d of DROIDS)
      for (const t of [0, 1200, 2500, 4000]) {
        const standby = standbyGlyphs[d](t);
        const cooling = dmdFrame(d, "cooling", t);
        for (let i = 0; i < standby.length; i++) {
          const v = standby[i] ?? 0;
          const expected = v > 0 ? Math.min(3, v + 1) : 0;
          expect(cooling[i]).toBe(expected);
        }
      }
  });
  it("is strictly brighter than standby (higher max and higher sum) for every droid", () => {
    for (const d of DROIDS) {
      const standby = dmdFrame(d, "idle", 1200);
      const cooling = dmdFrame(d, "cooling", 1200);
      const sum = (f: Uint8Array) => f.reduce((a, b) => a + b, 0);
      expect(Math.max(...cooling)).toBeGreaterThan(Math.max(...standby));
      expect(sum(cooling)).toBeGreaterThan(sum(standby));
    }
  });
  it("differs from active and stays in bounds", () => {
    for (const d of DROIDS) {
      const f = dmdFrame(d, "cooling", 1200);
      expect(f.length).toBe(64 * 32);
      expect(f).not.toEqual(dmdFrame(d, "active", 1200));
    }
  });
});

describe("domain", () => {
  it("domain without a domain glyph falls back to the cooling lift", () => {
    const dom = dmdFrame("ev-9d9", "domain", 1234, { primary: 1, secondary: 0 });
    const cool = dmdFrame("ev-9d9", "cooling", 1234);
    expect(Array.from(dom)).toEqual(Array.from(cool));
  });
});

describe("2-1b domain ECG", () => {
  const dom = (n: number) => dmdFrame("2-1b", "domain", 400, { primary: n, secondary: 0 });
  it("is deterministic and differs from active", () => {
    expect(Array.from(dom(2))).toEqual(Array.from(dom(2)));
    expect(Array.from(dom(2))).not.toEqual(Array.from(dmdFrame("2-1b", "active", 400)));
  });
  it("beat count scales with CI load", () => {
    // count v>=2 pixel clusters crossing the baseline band differs between 1 and 3 PRs
    expect(Array.from(dom(1))).not.toEqual(Array.from(dom(3)));
  });
  it("domain caps at intensity 3 only on <=2px tips, bulk <=2", () => {
    const f = dom(3);
    const bright = f.filter((v) => v === 3).length;
    expect(bright).toBeLessThanOrEqual(12); // tips only (<=2px per beat * 6 beats cap)
  });
});

describe("tt-8l shipping department", () => {
  it("standby has no gate bars anymore and is calm", () => {
    const f = dmdFrame("tt-8l", "idle", 0);
    expect(Math.max(...Array.from(f))).toBeLessThanOrEqual(2);
  });
  it("domain box count scales with the merge queue", () => {
    const one = dmdFrame("tt-8l", "domain", 700, { primary: 1, secondary: 0 });
    const three = dmdFrame("tt-8l", "domain", 700, { primary: 3, secondary: 0 });
    expect(Array.from(one)).not.toEqual(Array.from(three));
  });
  it("celebrate is the blast-off, not the diamond rings", () => {
    const tt = dmdFrame("tt-8l", "celebrate", 900);
    const other = dmdFrame("hk-47", "celebrate", 900);
    expect(Array.from(tt)).not.toEqual(Array.from(other));
  });
  it("blast-off is deterministic", () => {
    expect(Array.from(dmdFrame("tt-8l", "celebrate", 1234))).toEqual(
      Array.from(dmdFrame("tt-8l", "celebrate", 1234)),
    );
  });
  it("all tt-8l scene states stay above the flap band (rows 0-23)", () => {
    for (const [state, counts] of [
      ["idle", undefined],
      ["domain", { primary: 2, secondary: 0 }],
      ["active", undefined],
    ] as const) {
      const f = dmdFrame("tt-8l", state as DmdState, 500, counts as GlyphCounts | undefined);
      for (let y = 25; y < 32; y++) for (let x = 0; x < 64; x++) expect(f[y * 64 + x] ?? 0).toBe(0);
    }
  });
});
