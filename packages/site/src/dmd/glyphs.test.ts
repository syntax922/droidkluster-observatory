import { describe, expect, it } from "vitest";
import { blank, DMD_W, type Frame } from "./frame.js";
import {
  blastOffFrame,
  celebrateFrame,
  type DmdState,
  dmdFrame,
  drawHeartRing,
  type GlyphCounts,
  standbyGlyphs,
} from "./glyphs.js";

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

// 2-1b's full PQRST glyph family (task 2 of the ECG plan): a real sinus
// waveform (P-Q-R-S-T) in every state, an AFib rhythm (no P wave,
// irregularly-irregular R-R, fibrillatory baseline jitter) whenever
// counts.secondary > 0 (unresolved-red CI on an incomplete chain — see
// Task 1's derivePurview()["2-1b"].secondary), and always-AFib for "active"
// (diagnosing only happens because something failed). Supersedes the old
// "2-1b domain ECG" block, which pinned the pre-redesign single-spike
// morphology.
describe("2-1b PQRST", () => {
  const dom = (n: number, amiss = 0) =>
    dmdFrame("2-1b", "domain", 480, { primary: n, secondary: amiss });
  // Amplitude wave (2026-07-28): domainGlyphs["2-1b"]'s real baseline moved
  // 12->14 to buy headroom for the taller R spike. This constant must track
  // it — it drives every row computed below (pRegionLit, the recalibration
  // plant, the AFib-baseline-margin plant), and a stale value here silently
  // shifts every one of those checks onto the wrong absolute row without
  // failing (the P wave is tall/wide enough that several of the checks
  // still happened to land on lit pixels for the wrong reason — see the
  // corrected pRegionLit comment below for how this was caught).
  const DOMAIN_BASELINE_Y = 14;

  // Shared R-column finder: only the R spike (tip AND its steep upstroke
  // bridge) reaches y<6 (P/Q/S/T never do, at either baseline used by
  // 2-1b's states), so scanning for the topmost lit row per column and
  // thresholding at 6 isolates R-related columns.
  //
  // Fix round 1 (hardening, 2026-07-28): drawPqrst's R upstroke->tip bridge
  // (dx 8->9, a steep climb in one x-step) is steep enough to ALSO dip
  // below y<6 at dx=8, one column before the tip's own dx=9-10 (verified
  // empirically). The old version of this helper deduped adjacent
  // below-threshold columns down to the FIRST one encountered, which
  // coupled "the" R column to the upstroke bridge's exact steepness — a
  // future height/shape tweak could silently shift which column got
  // reported. Now it groups adjacent columns (same gap<=2 rule) and reports
  // each group's TRUE APEX — the column of that group's own global
  // minimum-y pixel, i.e. the actual highest point — which is always one of
  // the tip's own 2 columns (the tip is authored taller than the upstroke
  // in every case: AFib's height budget is clamp(.., 8, ..), always >5, the
  // upstroke's own offset — see drawAfibComplex), independent of how far
  // the upstroke bridge happens to reach.
  function rColumns(f: Frame): number[] {
    const hits: Array<[x: number, minY: number]> = [];
    for (let x = 0; x < DMD_W; x++) {
      let minY = 99;
      for (let y = 0; y < 24; y++) if ((f[y * DMD_W + x] ?? 0) > 0) minY = Math.min(minY, y);
      if (minY < 6) hits.push([x, minY]);
    }
    const groups: Array<Array<[x: number, minY: number]>> = [];
    for (const hit of hits) {
      const lastGroup = groups[groups.length - 1];
      const lastHit = lastGroup?.[lastGroup.length - 1];
      if (lastHit && hit[0] - lastHit[0] <= 2) lastGroup?.push(hit);
      else groups.push([hit]);
    }
    return groups.map((g) => g.reduce((best, cur) => (cur[1] < best[1] ? cur : best))[0]);
  }

  // P-wave discriminator (recalibrated for the morphology wave, 2026-07-28:
  // P widened from a 2-point bump to a 5-column rounded arc). The scan row
  // (baseline-2) is NOT the P peak itself — the amplitude wave (2026-07-28)
  // moved the peak to baseline-5 (was baseline-2 at the morphology wave) —
  // but baseline-2 sits squarely on P's rising/falling flank: drawPqrst's
  // samples span dy 0 (dx=0,4) through dy=-5 (dx=2, the peak) and every
  // intermediate row, including -2, is swept by the bridge connecting them
  // (verified empirically: baseline-2 is lit at dx=1 and dx=3, one column in
  // from each end of the hump). AFib's fibrillatory baseline jitter is
  // contractually only dy ∈ {-1, 0, 1} (see drawAfibWavelets), so it can
  // never reach baseline-2 regardless of which row within P's occupied band
  // ([-5, 0]) is chosen — baseline-2 isn't a special row, just a convenient
  // one comfortably inside that band. The window is centered on the P
  // peak's measured offset from rColumns()'s apex column (dx=2 relative to
  // xOrigin, dx=9 for the apex — a -7 delta), with a 2-column margin on
  // each side. The plant test below proves the margin doesn't swallow the
  // Q->R-upstroke bridge's own baseline-2 crossing (see drawPqrst's NOTE
  // comment) — that crossing's exact column now differs by rhythm (the
  // amplitude wave steepened sinus's Q->upstroke bridge more than AFib's,
  // see the plant's own comment), so the plant checks a small margin rather
  // than one hardcoded offset.
  function pRegionLit(f: Frame, rCol: number, baselineY: number): boolean {
    const row = baselineY - 2;
    for (let dx = -9; dx <= -5; dx++) {
      const x = rCol + dx;
      if (x >= 0 && x < DMD_W && (f[row * DMD_W + x] ?? 0) > 0) return true;
    }
    return false;
  }

  it("standby is a resting sinus: deterministic, ≤2, and no longer the flat-line blip", () => {
    const a = dmdFrame("2-1b", "idle", 800);
    expect(Array.from(a)).toEqual(Array.from(dmdFrame("2-1b", "idle", 800)));
    expect(Math.max(...Array.from(a))).toBeLessThanOrEqual(2);
    // A full-width flat baseline with a 3px block was the old blip; a sinus complex
    // has pixels ABOVE baseline-1 (P/R/T) — assert some pixel above y=13 exists.
    let above = 0;
    for (let y = 0; y < 14; y++) for (let x = 0; x < 64; x++) if ((a[y * 64 + x] ?? 0) > 0) above++;
    expect(above).toBeGreaterThan(0);
  });

  it("sinus morphology has a P-wave bump before each R spike; AFib has none", () => {
    const sinus = dom(2, 0) as Frame;
    const afib = dom(2, 1) as Frame;
    expect(Array.from(sinus)).not.toEqual(Array.from(afib));

    const sinusRs = rColumns(sinus);
    expect(sinusRs.length).toBeGreaterThanOrEqual(1);
    for (const rCol of sinusRs) expect(pRegionLit(sinus, rCol, DOMAIN_BASELINE_Y)).toBe(true);

    const afibRs = rColumns(afib);
    expect(afibRs.length).toBeGreaterThanOrEqual(1);
    for (const rCol of afibRs) expect(pRegionLit(afib, rCol, DOMAIN_BASELINE_Y)).toBe(false);
  });

  // Recalibration plant (morphology wave 2026-07-28; re-verified after fix
  // round 1's rColumns() hardening moved the apex column from the upstroke
  // to the tip's own start; re-verified again after the amplitude wave
  // moved the domain baseline 12->14 and steepened both QRS bridges;
  // re-verified again for the column-fill wave, 2026-07-28, which replaced
  // the Bresenham bridge with columnFillLine — see below for how the
  // mechanism, and the exact crossing column, changed).
  // Proves the P-window ([-9,-5]) isn't vacuously passing. The Q->R-upstroke
  // bridge (see drawPqrst's NOTE comment) genuinely DOES cross row
  // baseline-2, within 1-2 columns of the apex, in BOTH rhythms. This
  // bridge's destination (the R-upstroke) is a bulk-v point, not an accent,
  // so columnFillLine credits the WHOLE per-column span to the SOURCE
  // column (the Q point) regardless of the segment's steepness — see
  // columnFillLine's own comment. Under the old Bresenham bridge the
  // crossing column depended on each rhythm's own slope (sinus split at
  // relative offset -2, AFib at -1); column-fill's source-crediting rule
  // doesn't care about slope, so BOTH rhythms now land at the SAME relative
  // offset, -2 (Q's own column, one before the R-upstroke's) — verified
  // empirically. Checking a small margin ([-4,-1], entirely outside the
  // window's -5 edge) rather than one hardcoded offset covers both without
  // conflating them, and still holds even though the two rhythms no longer
  // differ. First confirm the crossing is real (so this isn't testing
  // nothing), then confirm the window excludes it.
  it("P-window survives the Q->R-upstroke bridge's own baseline-2 crossing (recalibration plant)", () => {
    for (const amiss of [0, 1] as const) {
      const f = dom(2, amiss) as Frame;
      const row = DOMAIN_BASELINE_Y - 2;
      for (const rCol of rColumns(f)) {
        // The bridge artifact is real: baseline-2 is lit somewhere in the
        // 4 columns immediately before the apex (margin, not an exact
        // offset — see comment above for why the exact column differs by
        // rhythm).
        let hit = false;
        for (let dx = -4; dx <= -1; dx++) {
          if ((f[row * DMD_W + (rCol + dx)] ?? 0) > 0) hit = true;
        }
        expect(hit).toBe(true);
      }
    }
    // And the discriminator still tells the rhythms apart correctly despite
    // that shared artifact sitting right next to the apex, just outside the
    // window's -5 edge.
    expect(
      rColumns(dom(2, 0) as Frame).every((c) =>
        pRegionLit(dom(2, 0) as Frame, c, DOMAIN_BASELINE_Y),
      ),
    ).toBe(true);
    expect(
      rColumns(dom(2, 1) as Frame).some((c) =>
        pRegionLit(dom(2, 1) as Frame, c, DOMAIN_BASELINE_Y),
      ),
    ).toBe(false);
  });

  it("AFib R-R intervals are irregularly irregular; sinus intervals are equal", () => {
    const sinusSpikes = rColumns(dom(3, 0) as Frame);
    const afibSpikes = rColumns(dom(3, 1) as Frame);
    expect(sinusSpikes.length).toBeGreaterThanOrEqual(2);
    expect(afibSpikes.length).toBeGreaterThanOrEqual(2);
    const gaps = (xs: number[]) => xs.slice(1).map((x, i) => x - (xs[i] as number));
    const sg = gaps(sinusSpikes);
    expect(new Set(sg).size).toBeLessThanOrEqual(2); // even spacing (±1 rounding)
    const ag = gaps(afibSpikes);
    expect(new Set(ag).size).toBe(ag.length); // pairwise distinct
  });

  it("active is AFib (diagnosing = something failed) and deterministic", () => {
    const act = dmdFrame("2-1b", "active", 640, { primary: 1, secondary: 0 });
    expect(Array.from(act)).toEqual(
      Array.from(dmdFrame("2-1b", "active", 640, { primary: 1, secondary: 0 })),
    );
    expect(Array.from(act)).not.toEqual(Array.from(dom(1, 0))); // not the sinus render
  });

  it("domain intensity caps hold in BOTH rhythms", () => {
    for (const amiss of [0, 1]) {
      const f = dom(3, amiss);
      // Sinus (amiss=0) renders at most 2 beats post-rescale (≤2px × 2);
      // AFib (amiss=1) is unchanged, up to the shared clamp(1,6) (≤2px × 3
      // here since primary=3). Same upper bound covers both without needing
      // to branch the assertion on rhythm.
      expect(f.filter((v) => v === 3).length).toBeLessThanOrEqual(6);
    }
  });

  it("ceiling clamp still holds in both rhythms", () => {
    // Sinus: the beat-count rescale (morphology wave, 2026-07-28) replaced
    // clamp(primary,1,6) with clamp(primary,1,2) FOR BEAT COUNT, but the R-R
    // SPACING that conveys load (drawSinusBeats) saturates at the same
    // primary=6 point the old cap used — so this invariant survives
    // unchanged in form: primary=6 and primary=10 still render identically,
    // just because the spacing formula's own clamp(primary,2,6) saturates,
    // not because the beat count does (that saturates already at primary=2).
    expect(Array.from(dom(6, 0))).toEqual(Array.from(dom(10, 0)));
    // AFib: untouched by the rescale — same clamp(1,6) as before.
    expect(Array.from(dom(6, 1))).toEqual(Array.from(dom(10, 1)));
  });

  // Beat-count rescale (morphology wave, 2026-07-28): pins the new mapping
  // directly, separate from the ceiling-clamp invariant above.
  describe("sinus beat-count rescale", () => {
    it("renders at most 2 full complexes at any primary, unlike AFib's up-to-6", () => {
      for (const primary of [1, 2, 3, 4, 6, 10]) {
        const sinusRs = rColumns(dom(primary, 0) as Frame);
        expect(sinusRs.length).toBeLessThanOrEqual(2);
      }
      // AFib at the same primary values can exceed 2 (it's still clamp(1,6)).
      const afibRs = rColumns(dom(6, 1) as Frame);
      expect(afibRs.length).toBeGreaterThan(2);
    });

    it("primary<=1 renders a single complex; primary>=2 renders two", () => {
      expect(rColumns(dom(1, 0) as Frame).length).toBe(1);
      expect(rColumns(dom(2, 0) as Frame).length).toBe(2);
    });

    it("R-R spacing between the two beats shrinks as primary rises from 2 to 6 (honest load signal)", () => {
      const gapAt = (primary: number) => {
        const cols = rColumns(dom(primary, 0) as Frame);
        expect(cols.length).toBe(2);
        return (cols[1] as number) - (cols[0] as number);
      };
      const gapLow = gapAt(2);
      const gapMid = gapAt(4);
      const gapHigh = gapAt(6);
      expect(gapLow).toBeGreaterThan(gapMid);
      expect(gapMid).toBeGreaterThan(gapHigh);
      // Never compresses enough for the two 22px-footprint complexes to
      // visually merge (26px min gap, per drawSinusBeats' own contract).
      // rCol is the R-tip apex (fixed dx=9 offset from each beat's xOrigin —
      // see rColumns' fix round 1 comment), so this gap should land exactly
      // on drawSinusBeats' own gap value; a small margin covers rounding.
      expect(gapHigh).toBeGreaterThanOrEqual(24);
    });

    it("spacing saturates at primary=6 — primary=6 and primary=10 have identical R-R gap", () => {
      const gapAt = (primary: number) => {
        const cols = rColumns(dom(primary, 0) as Frame);
        return (cols[1] as number) - (cols[0] as number);
      };
      expect(gapAt(6)).toBe(gapAt(10));
    });
  });

  // Fix round 1, P1 floor-side regression (2026-07-28): a reviewer sweep
  // found AFib's R-tip silently clipping off-frame at the domain baseline
  // (y=12) in ~10.5% of frames — h could jitter to 13-14, sending the tip
  // to y<=-1, which px()'s bounds check quietly no-ops. The fix caps h to
  // the available headroom (drawAfibComplex's own comment). Pin the FLOOR,
  // not just an upper bound: the v=3 pixel count must be EXACTLY beats
  // (1px tip x beats — the curvature wave narrowed the apex from 2px to a
  // single column so the spike converges to a point instead of a flat top;
  // see drawPqrst/drawAfibComplex), never less — across a real sweep of both primary
  // (which sets beats) and sweepIdx (which reseeds the PRNG driving
  // ampAdjust, per drawAfib's own comment on its rand stream), and across
  // BOTH baselines domain (12, the one that broke) and active (16, the one
  // that was already fine — pinned here so a future regression there would
  // also be caught).
  describe("AFib R-tip never clips (fix round 1 floor-side regression)", () => {
    const beatsFor = (primary: number) => Math.max(1, Math.min(6, primary));

    it("domain AFib: v=3 pixel count is exactly beats (1px tip) across a full (primary, sweepIdx) sweep", () => {
      for (const primary of [1, 2, 3, 4, 5, 6]) {
        for (let sweepIdx = 0; sweepIdx < 20; sweepIdx++) {
          const t = sweepIdx * 5120; // sweepMs, see drawAfib
          const f = dmdFrame("2-1b", "domain", t, { primary, secondary: 1 }) as Frame;
          const v3 = f.filter((v) => v === 3).length;
          expect(v3).toBe(beatsFor(primary));
        }
      }
    });

    it("active AFib: v=3 pixel count is exactly beats (1px tip) across the same sweep (baseline=16, already fine — pinned against future regression)", () => {
      for (const primary of [1, 2, 3, 4, 5, 6]) {
        for (let sweepIdx = 0; sweepIdx < 20; sweepIdx++) {
          const t = sweepIdx * 5120;
          const f = dmdFrame("2-1b", "active", t, { primary, secondary: 0 }) as Frame;
          const v3 = f.filter((v) => v === 3).length;
          expect(v3).toBe(beatsFor(primary));
        }
      }
    });

    it("domain AFib R height still varies (compressed, not flattened) — at least 2 distinct tip rows across the sweep", () => {
      const tipRows = new Set<number>();
      for (let sweepIdx = 0; sweepIdx < 20; sweepIdx++) {
        const t = sweepIdx * 5120;
        const f = dmdFrame("2-1b", "domain", t, { primary: 1, secondary: 1 }) as Frame;
        for (let y = 0; y < 24; y++)
          for (let x = 0; x < DMD_W; x++) if (f[y * DMD_W + x] === 3) tipRows.add(y);
      }
      expect(tipRows.size).toBeGreaterThanOrEqual(2);
    });
  });

  it("all 2-1b states stay in rows 0-23", () => {
    for (const [state, counts] of [
      ["idle", undefined],
      ["domain", { primary: 3, secondary: 1 }],
      ["active", { primary: 2, secondary: 2 }],
    ] as const) {
      const f = dmdFrame("2-1b", state as DmdState, 512, counts as GlyphCounts | undefined);
      for (let y = 25; y < 32; y++) for (let x = 0; x < 64; x++) expect(f[y * 64 + x] ?? 0).toBe(0);
    }
  });

  it("2-1b celebrate is the heart override, distinct from hk-47's diamond and tt-8l's blast-off", () => {
    const heart = dmdFrame("2-1b", "celebrate", 900);
    const diamond = dmdFrame("hk-47", "celebrate", 900);
    const blast = dmdFrame("tt-8l", "celebrate", 900, undefined, 500);
    expect(Array.from(heart)).not.toEqual(Array.from(diamond));
    expect(Array.from(heart)).not.toEqual(Array.from(blast));
  });

  it("2-1b celebrate is deterministic", () => {
    expect(Array.from(dmdFrame("2-1b", "celebrate", 1234))).toEqual(
      Array.from(dmdFrame("2-1b", "celebrate", 1234)),
    );
  });

  it("hk-47/ev-9d9 and tt-8l celebrate are unchanged by the 2-1b heart-override branch — pinned against the underlying renderers, which this task does not touch", () => {
    for (const t of [0, 333, 900, 1600]) {
      expect(Array.from(dmdFrame("hk-47", "celebrate", t))).toEqual(Array.from(celebrateFrame(t)));
      expect(Array.from(dmdFrame("ev-9d9", "celebrate", t))).toEqual(Array.from(celebrateFrame(t)));
    }
    for (const elapsed of [0, 500, 1500, 2900]) {
      expect(Array.from(dmdFrame("tt-8l", "celebrate", 87_654, undefined, elapsed))).toEqual(
        Array.from(blastOffFrame(elapsed)),
      );
    }
  });
});

// Fix round 1 (heart-ring legibility, P2): at r=8-12 the original
// fixed-density sampling produced isolated dots that fragmented into
// scatter on the flanks. drawHeartRing now bridges consecutive curve
// samples with a Bresenham line, so the outline is a single continuous
// chain by construction. This pins that structurally: every lit pixel of
// an isolated ring (not heartCelebrateFrame's overlaid pair — one ring in
// isolation, so gaps can't hide behind the second ring's pixels) must have
// at least one other lit pixel within Chebyshev distance 1, at every
// tested radius including the brief's called-out r=8-12 range.
describe("2-1b heart-ring continuity (fix round 1)", () => {
  it("a single ring's outline is a continuous chain — no fragmented scatter — at r=4,6,8,10,12,15", () => {
    for (const r of [4, 6, 8, 10, 12, 15]) {
      const f = blank();
      drawHeartRing(f, 32, 16, r, 3);
      const points: Array<[number, number]> = [];
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 64; x++) if ((f[y * 64 + x] ?? 0) > 0) points.push([x, y]);
      expect(points.length).toBeGreaterThan(0);
      for (const [x, y] of points) {
        const hasNeighbor = points.some(
          ([x2, y2]) => (x2 !== x || y2 !== y) && Math.max(Math.abs(x2 - x), Math.abs(y2 - y)) <= 1,
        );
        expect(hasNeighbor).toBe(true);
      }
    }
  });
});

// Fix round 2 (ECG trace continuity): the trace previously plotted one px
// per x-column, so steep QRS strokes (8-10 rows in 1-2 columns) fragmented
// into isolated dots — the same class of bug the heart ring had. drawPqrst
// and drawAfibComplex now bridge consecutive samples with plotLine (see
// tracePointPlotter). This pins it the same way the heart-ring fix round 1
// test does: every lit pixel in the scene band (rows 0-23) must have a
// Chebyshev-1 neighbor. Swept across a full 5120ms sweep (scroll period) at
// 80ms steps so the check also exercises the wrapX-seam guard (a complex's
// xOrigin drifts through every possible position relative to the board
// edge over one sweep) — the bridging must never leave a point isolated
// even when its bridge into/out of the seam is skipped.
describe("2-1b ECG trace continuity (fix round 2)", () => {
  function assertNoIsolatedDots(f: Frame): void {
    const points: Array<[number, number]> = [];
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < DMD_W; x++) if ((f[y * DMD_W + x] ?? 0) > 0) points.push([x, y]);
    expect(points.length).toBeGreaterThan(0);
    for (const [x, y] of points) {
      const hasNeighbor = points.some(
        ([x2, y2]) => (x2 !== x || y2 !== y) && Math.max(Math.abs(x2 - x), Math.abs(y2 - y)) <= 1,
      );
      expect(hasNeighbor).toBe(true);
    }
  }

  it("sinus (domain, beats=3) trace is a connected chain across a full sweep", () => {
    for (let t = 0; t < 5120; t += 80) {
      assertNoIsolatedDots(dmdFrame("2-1b", "domain", t, { primary: 3, secondary: 0 }));
    }
  });

  it("AFib (domain, amiss) trace is a connected chain across a full sweep", () => {
    for (let t = 0; t < 5120; t += 80) {
      assertNoIsolatedDots(dmdFrame("2-1b", "domain", t, { primary: 3, secondary: 1 }));
    }
  });

  it("standby (resting sinus) trace is also a connected chain", () => {
    for (let t = 0; t < 5000; t += 250) {
      assertNoIsolatedDots(dmdFrame("2-1b", "idle", t));
    }
  });

  it("active (always-AFib) trace is also a connected chain", () => {
    for (let t = 0; t < 5120; t += 80) {
      assertNoIsolatedDots(dmdFrame("2-1b", "active", t, { primary: 3, secondary: 0 }));
    }
  });

  it("QRS strokes read as connected strokes, not scattered dots — spot-check a single sinus complex", () => {
    // A single beat (primary=1) at a fixed t so the complex lands at a known
    // position; assert the R-tip column has a Chebyshev-adjacent lit pixel
    // immediately below it (the bridged upstroke), not a gap.
    const f = dmdFrame("2-1b", "domain", 0, { primary: 1, secondary: 0 }) as Frame;
    let tipX = -1;
    let tipY = 99;
    for (let x = 0; x < DMD_W; x++) {
      for (let y = 0; y < 24; y++) {
        if ((f[y * DMD_W + x] ?? 0) > 0 && y < tipY) {
          tipY = y;
          tipX = x;
        }
      }
    }
    expect(tipX).toBeGreaterThanOrEqual(0);
    // Something lit within 1px below/beside the topmost (R-tip) pixel —
    // the bridged upstroke, not an isolated apex dot.
    let neighborBelow = false;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = 1; dy <= 1; dy++)
        if ((f[(tipY + dy) * DMD_W + (tipX + dx)] ?? 0) > 0) neighborBelow = true;
    expect(neighborBelow).toBe(true);
  });
});

// Column-fill wave (2026-07-28): the fix round 2 guard above only required
// Chebyshev-1 (diagonal-OK) adjacency — a Bresenham diagonal stair-step
// already satisfies that trivially, since each step IS diagonally adjacent
// to the last by construction. But the user's live-board screenshot showed
// those diagonal-only seams as visible corner gaps at the DMD's round-dot
// pitch on steep strokes (the R up/downstrokes, the S recovery, the P/T
// shoulders) — the dots touch at a corner, not an edge, and the round dot
// shape leaves a visible notch there. The fix (columnFillLine) fills the
// FULL per-column span a bridged segment crosses, so every column's fill
// shares a full row with its neighboring column's fill — a strictly
// stronger, orthogonal (von Neumann: up/down/left/right only, diagonal does
// NOT count) adjacency contract. This pins that contract directly, the same
// way fix round 2 pinned Chebyshev-1: every lit pixel in the scene band must
// have an orthogonal lit neighbor, across a full sweep, in every
// state/rhythm combination.
// Fix round 1 (apex-widening P1, 2026-07-28): a reviewer sweep of the
// column-fill wave found the R apex row rendering 3px wide (bulk v beside
// both v=3 tip pixels) in ~97% of beats — columnFillLine credited a
// single-column entry bridge's WHOLE span to the SOURCE column, which for
// the upstroke->tip bridge includes the apex row itself, painting bulk v
// into the column immediately beside the tip at the exact tip row. This
// pins the needle contract the reviewer's scan implies: for every
// horizontal run of v=3 (tip) pixels, the pixels immediately left and right
// of the run, in that SAME row, must be unlit — a bulk-v neighbor there
// reads as a 3-wide (or wider) blob, not a sharp point.
describe("2-1b R-tip needle contract (fix round 1)", () => {
  function assertNeedleNotBlobbed(f: Frame): void {
    for (let y = 0; y < 24; y++) {
      let x = 0;
      while (x < DMD_W) {
        if (f[y * DMD_W + x] !== 3) {
          x++;
          continue;
        }
        let runEnd = x;
        while (runEnd + 1 < DMD_W && f[y * DMD_W + (runEnd + 1)] === 3) runEnd++;
        const leftX = x - 1;
        const rightX = runEnd + 1;
        if (leftX >= 0) {
          expect(
            f[y * DMD_W + leftX] ?? 0,
            `row ${y} col ${leftX} (left of v=3 run [${x},${runEnd}])`,
          ).toBe(0);
        }
        if (rightX < DMD_W) {
          expect(
            f[y * DMD_W + rightX] ?? 0,
            `row ${y} col ${rightX} (right of v=3 run [${x},${runEnd}])`,
          ).toBe(0);
        }
        x = runEnd + 1;
      }
    }
  }

  it("domain sinus: no bulk-v pixel flanks the R-tip run, swept across a full sweep", () => {
    for (let t = 0; t < 5120; t += 80) {
      assertNeedleNotBlobbed(dmdFrame("2-1b", "domain", t, { primary: 2, secondary: 0 }) as Frame);
    }
  });

  it("domain AFib: no bulk-v pixel flanks the R-tip run, swept across a full sweep", () => {
    for (let t = 0; t < 5120; t += 80) {
      assertNeedleNotBlobbed(dmdFrame("2-1b", "domain", t, { primary: 3, secondary: 1 }) as Frame);
    }
  });

  it("active (always-AFib): no bulk-v pixel flanks the R-tip run, swept across a full sweep", () => {
    for (let t = 0; t < 5120; t += 80) {
      assertNeedleNotBlobbed(dmdFrame("2-1b", "active", t, { primary: 3, secondary: 0 }) as Frame);
    }
  });

  it("standby: no bulk-v pixel flanks the R-tip run (tipV===v at standby, so this is vacuous but pinned anyway)", () => {
    for (let t = 0; t < 5000; t += 250) {
      assertNeedleNotBlobbed(dmdFrame("2-1b", "idle", t) as Frame);
    }
  });
});

describe("2-1b ECG trace orthogonal continuity (column-fill wave)", () => {
  function assertNoCornerOnlyGaps(f: Frame): void {
    const lit = new Set<string>();
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < DMD_W; x++) if ((f[y * DMD_W + x] ?? 0) > 0) lit.add(`${x},${y}`);
    expect(lit.size).toBeGreaterThan(0);
    for (const key of lit) {
      const [xs, ys] = key.split(",");
      const x = Number(xs);
      const y = Number(ys);
      const hasOrthogonalNeighbor =
        lit.has(`${x - 1},${y}`) ||
        lit.has(`${x + 1},${y}`) ||
        lit.has(`${x},${y - 1}`) ||
        lit.has(`${x},${y + 1}`);
      expect(hasOrthogonalNeighbor).toBe(true);
    }
  }

  it("sinus (domain, beats=3) trace is orthogonally connected across a full sweep", () => {
    for (let t = 0; t < 5120; t += 80) {
      assertNoCornerOnlyGaps(dmdFrame("2-1b", "domain", t, { primary: 3, secondary: 0 }) as Frame);
    }
  });

  it("AFib (domain, amiss) trace is orthogonally connected across a full sweep", () => {
    for (let t = 0; t < 5120; t += 80) {
      assertNoCornerOnlyGaps(dmdFrame("2-1b", "domain", t, { primary: 3, secondary: 1 }) as Frame);
    }
  });

  it("standby (resting sinus) trace is orthogonally connected", () => {
    for (let t = 0; t < 5000; t += 250) {
      assertNoCornerOnlyGaps(dmdFrame("2-1b", "idle", t) as Frame);
    }
  });

  it("active (always-AFib) trace is orthogonally connected across a full sweep", () => {
    for (let t = 0; t < 5120; t += 80) {
      assertNoCornerOnlyGaps(dmdFrame("2-1b", "active", t, { primary: 3, secondary: 0 }) as Frame);
    }
  });
});

// Fix round 3 (pen-line wave, 2026-07-28): the fix round 2 continuity guard
// above (assertNoIsolatedDots) already passed BEFORE this wave, because
// every AFib jitter dot sat Chebyshev-adjacent to the always-lit baseline
// hline underneath it — chebyshev-adjacency alone doesn't distinguish "one
// continuous pen-line" from "a dim guide-line with disconnected specks
// hovering next to it", which is exactly the bug the user's side-by-side
// comparison against a real rhythm strip found. This block pins the actual
// fix: every 2-1b pixel in the scene band renders at the SAME bulk
// intensity as the rest of that state's trace (only the R-tip differs, at
// tipV) — no v=1 baseline/wavelet pixels survive anywhere, across a full
// sweep, in every state/rhythm combination.
describe("2-1b uniform trace intensity (pen-line fix, round 3)", () => {
  function litValues(f: Frame): Set<number> {
    const vals = new Set<number>();
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < DMD_W; x++) {
        const v = f[y * DMD_W + x] ?? 0;
        if (v > 0) vals.add(v);
      }
    return vals;
  }

  it("standby (resting sinus): only v=2 ever appears — no dimmer v=1 baseline", () => {
    for (let t = 0; t < 5000; t += 250) {
      const vals = litValues(dmdFrame("2-1b", "idle", t) as Frame);
      expect(vals.has(1)).toBe(false);
      expect([...vals].every((v) => v === 2)).toBe(true);
    }
  });

  it("domain sinus: only v=2 (bulk) and v=3 (R-tip) appear — no v=1", () => {
    for (let t = 0; t < 5120; t += 80) {
      const vals = litValues(dmdFrame("2-1b", "domain", t, { primary: 2, secondary: 0 }) as Frame);
      expect(vals.has(1)).toBe(false);
      expect([...vals].every((v) => v === 2 || v === 3)).toBe(true);
    }
  });

  it("domain AFib: only v=2 (bulk, including the fibrillatory baseline) and v=3 (R-tip) appear — no v=1", () => {
    for (let t = 0; t < 5120; t += 80) {
      const vals = litValues(dmdFrame("2-1b", "domain", t, { primary: 3, secondary: 1 }) as Frame);
      expect(vals.has(1)).toBe(false);
      expect([...vals].every((v) => v === 2 || v === 3)).toBe(true);
    }
  });

  it("active (always AFib): only v=2 and v=3 appear — no v=1", () => {
    for (let t = 0; t < 5120; t += 80) {
      const vals = litValues(dmdFrame("2-1b", "active", t, { primary: 3, secondary: 0 }) as Frame);
      expect(vals.has(1)).toBe(false);
      expect([...vals].every((v) => v === 2 || v === 3)).toBe(true);
    }
  });

  // The undulating AFib baseline must never wander far enough to be mistaken
  // for the P wave's own baseline flank — see pRegionLit above. Plants the
  // amplitude contract directly against the wavelet renderer, independent of
  // the discriminator tests, across a full sweep and both baselines 2-1b's
  // AFib states use (14 domain, 16 active — amplitude wave, 2026-07-28:
  // domain was 12).
  it("AFib fibrillatory baseline never exceeds ±1px — the discriminator margin holds by construction", () => {
    // Any lit pixel at row baseline-2 must belong to a QRS complex (within a
    // few columns of a v=3 R-tip), never the wavelet — drawAfibWavelets'
    // amplitude contract is dy in {-1, 0, 1}, so it should never reach this
    // row on its own. Sweeping a full cycle catches any regression that
    // widens the wavelet's jitter range. The search window wraps around the
    // board edge (wrapX-style) since a beat's xOrigin scrolls continuously
    // and can straddle the x=0/63 seam.
    for (const [state, baselineY, counts] of [
      ["domain", 14, { primary: 1, secondary: 1 }],
      ["active", 16, { primary: 1, secondary: 0 }],
    ] as const) {
      for (let t = 0; t < 5120; t += 80) {
        const f = dmdFrame("2-1b", state, t, counts) as Frame;
        for (let x = 0; x < DMD_W; x++) {
          if ((f[(baselineY - 2) * DMD_W + x] ?? 0) === 0) continue;
          let nearTip = false;
          for (let dx = -3; dx <= 3; dx++) {
            const nx = (((x + dx) % DMD_W) + DMD_W) % DMD_W;
            for (let y = 0; y < baselineY; y++) {
              if (f[y * DMD_W + nx] === 3) nearTip = true;
            }
          }
          expect(nearTip).toBe(true);
        }
      }
    }
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

  // Box packing upgrade: paper drops into the open box, then the flaps FOLD
  // shut (hinged, angular keyframes) instead of shrinking to a line. Single
  // box (primary=1) so phase maps directly to t (2600ms cycle, no stagger
  // offset): parked at x=26 for p in [0.3, 0.75) — slide-in [0,0.3), paper
  // drop [0.3,0.45), fold [0.45,0.6), tape [0.6,0.75), slide-out [0.75,1).
  describe("box packing: paper drop + flap fold", () => {
    const boxX = 26;
    const boxTop = 14;
    const paperCols = [boxX + 4, boxX + 5, boxX + 6];
    const paperRows = [boxTop - 5, boxTop - 2, boxTop + 1, boxTop + 4]; // ys[] in drawPackingSlip

    function paperLit(f: Frame): boolean {
      return paperRows.some((y) => paperCols.some((x) => (f[y * DMD_W + x] ?? 0) === 2));
    }

    it("paper is visible during the open (drop) phase — both above and inside the box", () => {
      const rowAbove = paperRows[0] as number;
      const rowInside = paperRows[2] as number;
      const col = paperCols[1] as number;
      // t=800: dropP~0.128 -> stepIdx 0 (above the box, y=boxTop-5).
      const above = dmdFrame("tt-8l", "domain", 800, { primary: 1, secondary: 0 }) as Frame;
      expect(above[rowAbove * DMD_W + col]).toBe(2);
      // t=1000: dropP~0.564 -> stepIdx 2 (settled inside, y=boxTop+1).
      const inside = dmdFrame("tt-8l", "domain", 1000, { primary: 1, secondary: 0 }) as Frame;
      expect(inside[rowInside * DMD_W + col]).toBe(2);
    });

    it("paper is absent once the flaps have closed (fold phase onward)", () => {
      for (const t of [1200, 1400, 1600, 2000, 2500]) {
        const f = dmdFrame("tt-8l", "domain", t, { primary: 1, secondary: 0 }) as Frame;
        expect(paperLit(f)).toBe(false);
      }
    });

    it("flap fold shows >=3 distinct flap configurations across the fold window", () => {
      // Fold window is t in [1170, 1560). Sample densely and compare the
      // full frame (flap pixels are the only thing changing at fixed x=26).
      const samples: string[] = [];
      for (let t = 1175; t < 1560; t += 40) {
        samples.push(
          Array.from(dmdFrame("tt-8l", "domain", t, { primary: 1, secondary: 0 })).join(","),
        );
      }
      const distinct = new Set(samples);
      expect(distinct.size).toBeGreaterThanOrEqual(3);
    });

    it("fold keyframes are mirrored: at the outward-up and inward keyframes, the left/right flap tips are horizontally symmetric around the box center", () => {
      const boxW = 12;
      const centerX = boxX + (boxW - 1) / 2; // 31.5
      // outward-up keyframe: t=1180 (foldP~0.077 -> kf=0).
      const outward = dmdFrame("tt-8l", "domain", 1180, { primary: 1, secondary: 0 }) as Frame;
      // Left tip at (boxX-3, boxTop-3); right tip at (boxX+boxW+2, boxTop-3) — equidistant from centerX.
      expect(outward[(boxTop - 3) * DMD_W + (boxX - 3)]).toBeGreaterThan(0);
      expect(outward[(boxTop - 3) * DMD_W + (boxX + boxW + 2)]).toBeGreaterThan(0);
      expect(boxX - 3 - centerX).toBeCloseTo(-(boxX + boxW + 2 - centerX), 5);
    });

    it("all box-packing phases stay above the flap band (rows 0-23) and within the shipped intensity caps", () => {
      for (let t = 0; t < 2600; t += 50) {
        const f = dmdFrame("tt-8l", "domain", t, { primary: 1, secondary: 0 }) as Frame;
        for (let y = 24; y < 32; y++)
          for (let x = 0; x < DMD_W; x++) expect(f[y * DMD_W + x] ?? 0).toBe(0);
        const bright = f.filter((v) => v === 3).length;
        expect(bright).toBeLessThanOrEqual(2); // single box: <=2px v=3 tape-gun accent
      }
    });
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
    // 2-1b's standby was redesigned in the PQRST task (a full sinus complex
    // sweeping the width every 5s replaces the old single-blip crossing) and
    // now clears the bar too.
    ["2-1b standby", (t) => dmdFrame("2-1b", "idle", t)],
  ];
  for (const [label, render] of cases) {
    it(`${label}: at least 6 distinct frames across 13 samples over 6s`, () => {
      expect(distinctFrameCount(render)).toBeGreaterThanOrEqual(6);
    });
  }
});
