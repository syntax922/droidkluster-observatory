import { emptyFleetState, reduce } from "@observatory/core";
import { describe, expect, it, vi } from "vitest";
import { maybeCaptureChain } from "./capture.js";

function mergedPrState() {
  let s = emptyFleetState();
  const mk = (subject: string, payload: unknown, id: string) =>
    ({ kind: "event", id, subject, ts: "2026-07-25T14:00:00Z", payload }) as const;
  s = reduce(
    s,
    mk(
      "gh.event.dungeonadventures.pr.opened.9",
      {
        action: "opened",
        pull_request: { number: 9, head: { sha: "x" } },
        repository: { full_name: "x/d" },
      },
      "e1",
    ),
  ).state;
  const r = reduce(
    s,
    mk(
      "gh.event.dungeonadventures.pr.closed.9",
      {
        action: "closed",
        pull_request: { number: 9, merged: true, head: { sha: "x" } },
        repository: { full_name: "x/d" },
      },
      "e2",
    ),
  );
  return { state: r.state, emitted: r.emitted };
}

describe("maybeCaptureChain", () => {
  it("writes a schema-valid replay bundle when a chain completes", async () => {
    const { state, emitted } = mergedPrState();
    const writer = { putJson: vi.fn().mockResolvedValue(undefined), getJson: vi.fn() };
    await maybeCaptureChain(state, emitted, writer as never, () => {});
    expect(writer.putJson).toHaveBeenCalledTimes(1);
    const [key, bundle, cache] = writer.putJson.mock.calls[0] ?? [];
    expect(key).toBe("chains/pr-9-2026-07-25.json");
    expect(cache).toBe(3600);
    expect(bundle).toMatchObject({ pr: 9, id: "pr-9-2026-07-25" });
    expect(bundle.events.length).toBeGreaterThan(0);
  });

  it("does nothing for non-terminal events", async () => {
    const s = emptyFleetState();
    const r = reduce(s, {
      kind: "event",
      id: "a",
      subject: "gh.event.dungeonadventures.pr.opened.9",
      ts: "2026-07-25T14:00:00Z",
      payload: {
        action: "opened",
        pull_request: { number: 9, head: { sha: "x" } },
        repository: { full_name: "x/d" },
      },
    });
    const writer = { putJson: vi.fn(), getJson: vi.fn() };
    await maybeCaptureChain(r.state, r.emitted, writer as never, () => {});
    expect(writer.putJson).not.toHaveBeenCalled();
  });

  it("validation failure is logged, not thrown", async () => {
    const { state, emitted } = mergedPrState();
    // Corrupt the timestamp to trigger validation failure
    const chain = state.chains.get(9);
    if (chain && chain.events.length > 0) {
      const firstEvent = chain.events[0];
      if (firstEvent) {
        firstEvent.at = "not-a-timestamp";
      }
    }
    const writer = { putJson: vi.fn(), getJson: vi.fn() };
    const logSpy = vi.fn();
    await expect(
      maybeCaptureChain(state, emitted, writer as never, logSpy),
    ).resolves.toBeUndefined();
    expect(writer.putJson).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      "chain capture failed",
      expect.objectContaining({
        id: "pr-9-2026-07-25",
        err: expect.any(String),
      }),
    );
    // Events should NOT be cleared on validation failure
    expect(chain?.events.length).toBeGreaterThan(0);
  });
});
