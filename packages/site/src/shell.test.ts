import type { CurrentSnapshot } from "@observatory/core";
import { describe, expect, it } from "vitest";
import { decideMode } from "./shell.js";

const NOW = Date.parse("2026-07-25T14:00:00Z");

function snap(over: Partial<CurrentSnapshot>): CurrentSnapshot {
  return {
    generated_at: "2026-07-25T13:59:50Z",
    last_contact: "2026-07-25T13:59:50Z",
    droids: [],
    chains: [],
    ...over,
  };
}

describe("decideMode", () => {
  it("live when a chain is active and telemetry fresh", () => {
    expect(
      decideMode(
        snap({
          chains: [
            { pr: 1, hops: [], updated_at: "2026-07-25T13:58:00Z", active: true, complete: false },
          ],
        }),
        NOW,
      ),
    ).toBe("live");
  });
  it("live when a chain just completed (not active) but finished moments ago", () => {
    expect(
      decideMode(
        snap({
          chains: [
            { pr: 1, hops: [], updated_at: "2026-07-25T13:59:50Z", active: false, complete: true },
          ],
        }),
        NOW,
      ),
    ).toBe("live");
  });
  it("replay when telemetry fresh but nothing active for 10+ min", () => {
    expect(
      decideMode(
        snap({
          chains: [
            { pr: 1, hops: [], updated_at: "2026-07-25T13:40:00Z", active: false, complete: true },
          ],
        }),
        NOW,
      ),
    ).toBe("replay");
  });
  it("stale when last_contact older than 5 min", () => {
    expect(decideMode(snap({ last_contact: "2026-07-25T13:50:00Z" }), NOW)).toBe("stale");
  });
});
