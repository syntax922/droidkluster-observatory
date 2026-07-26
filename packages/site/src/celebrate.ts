import type { Chain } from "@observatory/core";

const CELEBRATE_MS = 3000;

// Edge-triggered: celebrates for CELEBRATE_MS of *display* time whenever a
// pr_merged hop newer than any previously seen arrives — works identically
// in live mode (pipeline latency irrelevant) and replay (compression irrelevant).
export function createCelebrationTracker(now: () => number = () => Date.now()) {
  let newestSeen = "";
  let celebrateUntil = 0;
  return {
    observe(chains: Chain[]): boolean {
      for (const c of chains) {
        for (const h of c.hops) {
          if (h.kind === "pr_merged" && h.at > newestSeen) {
            newestSeen = h.at;
            celebrateUntil = now() + CELEBRATE_MS;
          }
        }
      }
      return now() < celebrateUntil;
    },
  };
}
