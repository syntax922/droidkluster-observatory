import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReplayBundle, fetchReplayIndex, fetchSnapshot, startPolling } from "./data.js";

const good = {
  generated_at: "2026-07-25T14:00:00Z",
  last_contact: "2026-07-25T14:00:00Z",
  droids: [{ droid: "hk-47", state: "idle" }],
  chains: [],
};

const goodIndex = {
  replays: [
    {
      id: "replay-1",
      title: "Test Replay",
      date: "2026-07-25",
      summary: "A test replay",
    },
  ],
};

const goodBundle = {
  id: "replay-1",
  title: "Test Replay",
  captured_on: "2026-07-25T14:00:00Z",
  pr: 123,
  events: [
    {
      id: "evt-1",
      at: "2026-07-25T14:00:00Z",
      droid: "hk-47",
      kind: "pr_opened",
      pr: 123,
      summary: "PR opened",
    },
  ],
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
  it("normalizes trailing slash in base URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(good)));
    vi.stubGlobal("fetch", fetchMock);
    await fetchSnapshot("https://data.example/");
    expect(fetchMock).toHaveBeenCalledWith("https://data.example/current.json", {
      cache: "no-cache",
    });
  });
});

describe("fetchReplayIndex", () => {
  it("returns a parsed replay index on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(goodIndex))));
    const result = await fetchReplayIndex("https://data.example");
    expect(result).toMatchObject({
      replays: [{ id: "replay-1", title: "Test Replay" }],
    });
  });
  it("returns null on schema-invalid payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ nope: 1 }))));
    expect(await fetchReplayIndex("https://data.example")).toBeNull();
  });
});

describe("fetchReplayBundle", () => {
  it("returns a parsed replay bundle on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(goodBundle))));
    const result = await fetchReplayBundle("https://data.example", "replay-1");
    expect(result).toMatchObject({
      id: "replay-1",
      title: "Test Replay",
      events: [{ kind: "pr_opened", pr: 123 }],
    });
  });
  it("returns null on schema-invalid payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ nope: 1 }))));
    expect(await fetchReplayBundle("https://data.example", "replay-1")).toBeNull();
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

  it("does not fire onSnapshot after stop() when a poll is in flight", async () => {
    vi.useFakeTimers();
    const resolverRef: { fn: ((value: Response) => void) | null } = { fn: null };
    const pendingPromise = new Promise<Response>((resolve) => {
      resolverRef.fn = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(pendingPromise);
    vi.stubGlobal("fetch", fetchMock);
    const onSnapshot = vi.fn();
    const onStale = vi.fn();
    const stop = startPolling({
      base: "https://data.example",
      intervalMs: 1000,
      onSnapshot,
      onStale,
    });
    // First poll starts but hasn't completed
    await vi.advanceTimersByTimeAsync(1);
    stop();
    // Resolve the pending fetch after stop() was called
    if (resolverRef.fn) {
      resolverRef.fn(new Response(JSON.stringify(good)));
    }
    await vi.advanceTimersByTimeAsync(10);
    // onSnapshot should never be called because stop was called before the fetch resolved
    expect(onSnapshot).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("environment", () => {
  it("runs under jsdom", () => {
    expect(typeof document).not.toBe("undefined");
  });
});
