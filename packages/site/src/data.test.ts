import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSnapshot, startPolling } from "./data.js";

const good = {
  generated_at: "2026-07-25T14:00:00Z",
  last_contact: "2026-07-25T14:00:00Z",
  droids: [{ droid: "hk-47", state: "idle" }],
  chains: [],
};

afterEach(() => vi.restoreAllMocks());

describe("fetchSnapshot", () => {
  it("returns a parsed snapshot on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(good))));
    expect(await fetchSnapshot("https://data.example")).toMatchObject({
      droids: [{ droid: "hk-47" }],
    });
  });
  it("returns null on schema-invalid payload (last-good preserved by caller)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ nope: 1 }))));
    expect(await fetchSnapshot("https://data.example")).toBeNull();
  });
  it("returns null on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchSnapshot("https://data.example")).toBeNull();
  });
});

describe("startPolling", () => {
  it("delivers snapshots and reports staleness on failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(good)))
      .mockRejectedValueOnce(new Error("down"));
    vi.stubGlobal("fetch", fetchMock);
    const onSnapshot = vi.fn();
    const onStale = vi.fn();
    const stop = startPolling({
      base: "https://data.example",
      intervalMs: 1000,
      onSnapshot,
      onStale,
    });
    await vi.advanceTimersByTimeAsync(10); // immediate first poll
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onStale).toHaveBeenCalledWith(
      expect.objectContaining({ generated_at: good.generated_at }),
    );
    stop();
    vi.useRealTimers();
  });
});
