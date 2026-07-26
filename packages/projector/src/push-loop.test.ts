import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPushLoop } from "./push-loop.js";

const snapshot = { generated_at: "t", last_contact: "t", droids: [], chains: [] };

function makeWriter() {
  return { putJson: vi.fn().mockResolvedValue(undefined), getJson: vi.fn() };
}

describe("startPushLoop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("markDirty pushes current + feed after the debounce window", async () => {
    const writer = makeWriter();
    const loop = startPushLoop({
      enabled: true,
      writer: writer as never,
      getSnapshot: () => snapshot as never,
      getFeedDay: () => ({ key: "feed/2026-07-25.json", events: [] }),
      debounceMs: 1000,
      heartbeatMs: 60_000,
      log: () => {},
    });
    loop.markDirty();
    loop.markDirty(); // coalesces
    await vi.advanceTimersByTimeAsync(1100);
    expect(writer.putJson).toHaveBeenCalledWith("current.json", snapshot, 15);
    expect(writer.putJson).toHaveBeenCalledWith("feed/2026-07-25.json", { events: [] }, 60);
    loop.stop();
  });

  it("heartbeat pushes current.json even without dirt", async () => {
    const writer = makeWriter();
    const loop = startPushLoop({
      enabled: true,
      writer: writer as never,
      getSnapshot: () => snapshot as never,
      getFeedDay: () => ({ key: "feed/x.json", events: [] }),
      debounceMs: 1000,
      heartbeatMs: 5000,
      log: () => {},
    });
    await vi.advanceTimersByTimeAsync(5100);
    expect(writer.putJson).toHaveBeenCalledWith("current.json", snapshot, 15);
    loop.stop();
  });

  it("kill switch: enabled=false never pushes", async () => {
    const writer = makeWriter();
    const loop = startPushLoop({
      enabled: false,
      writer: writer as never,
      getSnapshot: () => snapshot as never,
      getFeedDay: () => ({ key: "feed/x.json", events: [] }),
      debounceMs: 100,
      heartbeatMs: 200,
      log: () => {},
    });
    loop.markDirty();
    await vi.advanceTimersByTimeAsync(1000);
    expect(writer.putJson).not.toHaveBeenCalled();
    loop.stop();
  });
});
