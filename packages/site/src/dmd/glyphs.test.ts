import { describe, expect, it } from "vitest";
import { DMD_W, type Frame, blank } from "./frame.js";
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
  it("beat count clamps at 6 — primary=6 and primary=10 render identically", () => {
    expect(Array.from(dom(6))).toEqual(Array.from(dom(10)));
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
  it("box count clamps at 3 — primary=3 and primary=5 render identically", () => {
    const three = dmdFrame("tt-8l", "domain", 700, { primary: 3, secondary: 0 });
    const five = dmdFrame("tt-8l", "domain", 700, { primary: 5, secondary: 0 });
    expect(Array.from(three)).toEqual(Array.from(five));
  });
  it("domain caps at intensity 3 only on <=2px accents per box (bulk <=2)", () => {
    for (const t of [0, 400, 900, 1300, 1800, 2200, 2599]) {
      const f = dmdFrame("tt-8l", "domain", t, { primary: 3, secondary: 0 });
      const bright = f.filter((v) => v === 3).length;
      expect(bright).toBeLessThanOrEqual(6); // 2px accent * 3 boxes max
    }
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
  it("blast-off arc is anchored to celebration-elapsed time, not the free-running clock", () => {
    // Pin the bug: two wildly different tMs values (the free-running paint
    // clock) must render the SAME frame when the celebration-elapsed time
    // (the 5th arg) is the same — the arc's phase depends only on how far
    // into the celebration we are, never on when the clock happens to read.
    const a = dmdFrame("tt-8l", "celebrate", 900, undefined, 500);
    const b = dmdFrame("tt-8l", "celebrate", 87_654, undefined, 500);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
  it("at elapsed=0 the rocket sits at pad level; by elapsed~2900 it's climbed near/off the top", () => {
    const idx = (y: number, x: number) => y * DMD_W + x;
    const atStart = dmdFrame("tt-8l", "celebrate", 0, undefined, 0);
    const nearTop = dmdFrame("tt-8l", "celebrate", 0, undefined, 2900);
    // Pad-level body top row (bodyTop=8 at riseY=0): lit at elapsed=0...
    expect(atStart[idx(8, 48)]).toBeGreaterThan(0);
    // ...but the climb has carried the body well clear of that row by 2900ms.
    expect(nearTop[idx(8, 48)] ?? 0).toBe(0);
    // And the rocket's tail is now hugging the top of the board (row 0-1),
    // clipped by px()'s bounds check on everything above it — "near/off the
    // top", not still mid-climb.
    const topRows = [0, 1].some(
      (y) => (nearTop[idx(y, 47)] ?? 0) > 0 || (nearTop[idx(y, 54)] ?? 0) > 0,
    );
    expect(topRows).toBe(true);
  });
  it("defaults to the pad frame (elapsed=0) when no elapsed is supplied — never the old modulo-of-tMs behavior", () => {
    const noElapsedArg = dmdFrame("tt-8l", "celebrate", 87_654);
    const explicitZero = dmdFrame("tt-8l", "celebrate", 0, undefined, 0);
    expect(Array.from(noElapsedArg)).toEqual(Array.from(explicitZero));
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

describe("hk-47 desk", () => {
  it("inbox scales with reviews in flight, outbox with posted", () => {
    const a = dmdFrame("hk-47", "active", 500, { primary: 1, secondary: 0 });
    const b = dmdFrame("hk-47", "active", 500, { primary: 4, secondary: 0 });
    const c = dmdFrame("hk-47", "active", 500, { primary: 1, secondary: 3 });
    expect(Array.from(a)).not.toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });
  // Controller ruling (2026-07-27, replay-liveliness pairing): the original
  // fully-static domain rule is relaxed — ambient motion (droid presence
  // breathing) is now allowed, but there must still be no SHEET/WORK motion,
  // and the shipped intensity caps still hold. Replaces the old d1≡d2 static
  // pin with three narrower pins: (a) domain frames differ across tMs, (b)
  // the sheet's travel region — the gaps between the inbox/outbox trays and
  // the desk, columns no furniture or tray ever reaches, where only a
  // mid-flight sheet could ever place a pixel — stays fully unlit at every
  // sampled tMs across a full cycle, (c) intensity caps hold throughout.
  it("domain is dimmer than active, sheetless, and ambient-alive (not static)", () => {
    const counts = { primary: 2, secondary: 0 };
    const samples = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000];
    const frames = samples.map((t) => dmdFrame("hk-47", "domain", t, counts));

    // (a) domain frames DO differ across tMs now.
    const distinct = new Set(frames.map((f) => Array.from(f).join(",")));
    expect(distinct.size).toBeGreaterThan(1);

    for (const f of frames) {
      // (b) sheet travel region: x in [15,20) sits strictly between the
      // inbox tray's right edge (x=14) and the desk's left edge (x=20); x in
      // [45,50) sits strictly between the desk's right edge (x=44) and the
      // outbox tray's left edge (x=50). Neither furniture nor a tray fill
      // ever reaches these columns — only drawHkSheet (not called in domain)
      // would. Checked across the full frame height.
      for (const [lo, hi] of [
        [15, 20],
        [45, 50],
      ] as const) {
        for (let x = lo; x < hi; x++) {
          for (let y = 0; y < 32; y++) expect(f[y * DMD_W + x] ?? 0).toBe(0);
        }
      }
      // (c) intensity caps hold: bulk <=2 (and, since the sheet's v=3
      // flicker accent is never drawn here, no v=3 pixel exists at all).
      expect(Math.max(...f)).toBeLessThanOrEqual(2);
    }
  });
  it("standby is calm (<=2) and deterministic", () => {
    expect(Array.from(dmdFrame("hk-47", "idle", 100))).toEqual(
      Array.from(dmdFrame("hk-47", "idle", 100)),
    );
    expect(Math.max(...Array.from(dmdFrame("hk-47", "idle", 100)))).toBeLessThanOrEqual(2);
  });
  it("domain inbox/outbox scale with counts (purview height)", () => {
    const a = dmdFrame("hk-47", "domain", 500, { primary: 1, secondary: 0 });
    const b = dmdFrame("hk-47", "domain", 500, { primary: 4, secondary: 3 });
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
  it("active inbox clamps at 6 — primary=6 and primary=9 render identically", () => {
    const six = dmdFrame("hk-47", "active", 500, { primary: 6, secondary: 0 });
    const nine = dmdFrame("hk-47", "active", 500, { primary: 9, secondary: 0 });
    expect(Array.from(six)).toEqual(Array.from(nine));
  });
  it("active outbox clamps at 6 — secondary=6 and secondary=9 render identically", () => {
    const six = dmdFrame("hk-47", "active", 500, { primary: 0, secondary: 6 });
    const nine = dmdFrame("hk-47", "active", 500, { primary: 0, secondary: 9 });
    expect(Array.from(six)).toEqual(Array.from(nine));
  });
  it("domain inbox/outbox clamp at 6 — 6 and 9 render identically", () => {
    const six = dmdFrame("hk-47", "domain", 500, { primary: 6, secondary: 6 });
    const nine = dmdFrame("hk-47", "domain", 500, { primary: 9, secondary: 9 });
    expect(Array.from(six)).toEqual(Array.from(nine));
  });
});

describe("r5 weld line", () => {
  it("active sparks exist under the arch at some phase", () => {
    // scan a full cycle: at least one tMs shows v=3 pixels in the arch region
    let sparked = false;
    for (let t = 0; t < 3000; t += 70) {
      const f = dmdFrame("r5", "active", t, { primary: 0, secondary: 2 });
      for (let y = 4; y < 16 && !sparked; y++)
        for (let x = 26; x < 38; x++)
          if (f[y * 64 + x] === 3) {
            sparked = true;
            break;
          }
      if (sparked) break;
    }
    expect(sparked).toBe(true);
  });
  it("domain chassis count scales with in-flight dispatches", () => {
    const one = dmdFrame("r5", "domain", 900, { primary: 0, secondary: 1 });
    const four = dmdFrame("r5", "domain", 900, { primary: 0, secondary: 4 });
    expect(Array.from(one)).not.toEqual(Array.from(four));
  });
  it("both families stay above the flap band", () => {
    for (const droid of ["hk-47", "r5"] as const) {
      const f = dmdFrame(droid, "active", 640, { primary: 2, secondary: 2 });
      for (let y = 25; y < 32; y++) for (let x = 0; x < 64; x++) expect(f[y * 64 + x] ?? 0).toBe(0);
    }
  });
  it("active chassis count clamps at 4 — secondary=4 and secondary=9 render identically", () => {
    const four = dmdFrame("r5", "active", 900, { primary: 0, secondary: 4 });
    const nine = dmdFrame("r5", "active", 900, { primary: 0, secondary: 9 });
    expect(Array.from(four)).toEqual(Array.from(nine));
  });
  it("domain chassis count clamps at 4 — secondary=4 and secondary=9 render identically", () => {
    const four = dmdFrame("r5", "domain", 900, { primary: 0, secondary: 4 });
    const nine = dmdFrame("r5", "domain", 900, { primary: 0, secondary: 9 });
    expect(Array.from(four)).toEqual(Array.from(nine));
  });
  it("domain sparks stay within the <=2px v=3 tip cap across a full cycle", () => {
    for (let t = 0; t < 3000; t += 70) {
      const f = dmdFrame("r5", "domain", t, { primary: 0, secondary: 4 });
      const bright = f.filter((v) => v === 3).length;
      expect(bright).toBeLessThanOrEqual(2);
    }
  });
});

// LIVELINESS BAR (controller ruling, replay-liveliness pairing, 2026-07-27):
// the root-cause debug report measured hk-47's pre-purview idle glyph
// changing ~1.0×/s versus ~0.2×/s post-purview — a ~5x drop from a "row
// count breathes" idiom collapsing to a single binary intensity toggle.
// This pins the restored bar deterministically: sampling a glyph at 500ms
// intervals over a 6s window (13 samples, matching the report's own probe
// cadence) must surface at least 6 DISTINCT frames — approximately the
// >=1-visible-change/sec the pre-purview glyphs had. Run for every glyph
// this pairing touched (hk-47/tt-8l/r5 standby, hk-47 domain) plus ev-9d9
// (untouched — already had a continuous sweep — verified here rather than
// assumed).
function distinctFrameCount(render: (tMs: number) => Frame): number {
  const seen = new Set<string>();
  for (let i = 0; i < 13; i++) seen.add(Array.from(render(i * 500)).join(","));
  return seen.size;
}

describe("liveliness bar — calm glyphs show >=1 visible change/sec", () => {
  const cases: Array<[string, (t: number) => Frame]> = [
    ["hk-47 standby", (t) => dmdFrame("hk-47", "idle", t)],
    ["tt-8l standby", (t) => dmdFrame("tt-8l", "idle", t)],
    ["r5 standby", (t) => dmdFrame("r5", "idle", t)],
    ["ev-9d9 standby", (t) => dmdFrame("ev-9d9", "idle", t)],
    ["hk-47 domain", (t) => dmdFrame("hk-47", "domain", t, { primary: 2, secondary: 2 })],
  ];
  for (const [label, render] of cases) {
    it(`${label}: at least 6 distinct frames across 13 samples over 6s`, () => {
      expect(distinctFrameCount(render)).toBeGreaterThanOrEqual(6);
    });
  }
  // 2-1b's standby is intentionally left byte-identical pending a separate
  // redesign spec — NOT held to this bar yet, and NOT touched by this
  // pairing. Documented here so its absence from the cases list above reads
  // as a deliberate exclusion, not an oversight.
});
