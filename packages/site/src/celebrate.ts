import type { Chain } from "@observatory/core";

const CELEBRATE_MS = 3000;

// Edge-triggered: celebrates for CELEBRATE_MS of *display* time whenever a
// pr_merged hop newer than any previously seen arrives — works identically
// in live mode (pipeline latency irrelevant) and replay (compression irrelevant).
export function createCelebrationTracker(now: () => number = () => Date.now()) {
  let newestSeen = "";
  let celebrateUntil = 0;
  // When the CURRENT celebration span began (tracker's own now() domain). A
  // merge that lands mid-celebration extends celebrateUntil but does NOT
  // reset this — the rocket keeps climbing instead of snapping back to the
  // pad on every merge in a burst.
  let celebrateStartedAt = 0;
  return {
    observe(chains: Chain[]): boolean {
      for (const c of chains) {
        for (const h of c.hops) {
          if (h.kind === "pr_merged" && h.at > newestSeen) {
            newestSeen = h.at;
            const t = now();
            if (t >= celebrateUntil) celebrateStartedAt = t; // was not celebrating: new span
            celebrateUntil = t + CELEBRATE_MS;
          }
        }
      }
      return now() < celebrateUntil;
    },
    // Ms elapsed since the current celebration span began, measured entirely
    // in the tracker's own now()-domain (both readings come from the same
    // now()), or null when not currently celebrating. Deliberately NOT a raw
    // timestamp for the caller to diff against some other clock — main.ts's
    // BoardView.renderedAtMs is real time in live mode but a replayed
    // historical time in replay mode, and this tracker always runs on real
    // display-clock time in both (see the module comment above), so handing
    // back a timestamp for the caller to subtract from renderedAtMs would
    // silently corrupt replay. The display side (dmd/controller.ts) then
    // adds its own paint-clock delta on top of this single anchor value to
    // animate smoothly between the infrequent observe() calls.
    elapsedMs(): number | null {
      const t = now();
      return t < celebrateUntil ? t - celebrateStartedAt : null;
    },
  };
}
