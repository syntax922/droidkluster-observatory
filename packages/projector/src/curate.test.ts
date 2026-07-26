import { describe, expect, it, vi } from "vitest";
import { promote } from "./curate.js";
import type { EdgeWriter } from "./edge.js";

describe("promote", () => {
  it("null index triggers stderr warning and writes fresh index", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error");
    const consoleLogSpy = vi.spyOn(console, "log");
    const writer = {
      getJson: vi.fn(async (key: string) => {
        if (key === "chains/pr-1607-2026-07-23.json") {
          return {
            id: "pr-1607-2026-07-23",
            title: "old title",
            captured_on: "2026-07-23",
            pr: 1607,
            events: [
              {
                id: "e1",
                at: "2026-07-23T10:00:00Z",
                droid: "system",
                kind: "pr_opened",
                pr: 1607,
                summary: "PR #1607 opened",
              },
            ],
          };
        }
        return null;
      }),
      putJson: vi.fn(async () => {}),
    };

    await promote(writer as unknown as EdgeWriter, {
      chain: "pr-1607-2026-07-23",
      title: "New Title",
      summary: "Test summary",
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "index read returned null — writing fresh index (could clobber on transient outage); re-run to verify",
    );
    expect(consoleLogSpy).toHaveBeenCalledWith("promoted pr-1607-2026-07-23 (1 in rotation)");

    const putJsonMock = writer.putJson as ReturnType<typeof vi.fn>;
    const putCalls = putJsonMock.mock.calls;
    expect(putCalls).toHaveLength(2);

    // Check replays/<id>.json was written with 86400 cache
    const call1 = putCalls[0];
    expect(call1).toBeDefined();
    if (call1) {
      const [key1, bundle, cache1] = call1;
      expect(key1).toBe("replays/pr-1607-2026-07-23.json");
      expect((bundle as Record<string, unknown>).title).toBe("New Title");
      expect(cache1).toBe(86_400);
    }

    // Check replays/index.json was written with fresh index, cache 300
    const call2 = putCalls[1];
    expect(call2).toBeDefined();
    if (call2) {
      const [key2, index, cache2] = call2;
      expect(key2).toBe("replays/index.json");
      const indexData = index as Record<string, unknown>;
      const replays = indexData.replays as Array<Record<string, unknown>>;
      expect(replays).toHaveLength(1);
      expect(replays[0]).toMatchObject({
        id: "pr-1607-2026-07-23",
        title: "New Title",
        summary: "Test summary",
      });
      expect(cache2).toBe(300);
    }

    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("existing index dedups by id, new entry first", async () => {
    const consoleLogSpy = vi.spyOn(console, "log");
    const writer = {
      getJson: vi.fn(async (key: string) => {
        if (key === "chains/pr-99-2026-07-25.json") {
          return {
            id: "pr-99-2026-07-25",
            title: "original",
            captured_on: "2026-07-25",
            pr: 99,
            events: [
              {
                id: "e1",
                at: "2026-07-25T12:00:00Z",
                droid: "system",
                kind: "pr_opened",
                pr: 99,
                summary: "PR #99 opened",
              },
            ],
          };
        }
        if (key === "replays/index.json") {
          return {
            replays: [
              {
                id: "pr-99-2026-07-25",
                title: "old title for pr-99",
                date: "2026-07-25",
                summary: "old summary",
              },
              {
                id: "pr-98-2026-07-24",
                title: "other PR",
                date: "2026-07-24",
                summary: "another replay",
              },
            ],
          };
        }
        return null;
      }),
      putJson: vi.fn(async () => {}),
    };

    await promote(writer as unknown as EdgeWriter, {
      chain: "pr-99-2026-07-25",
      title: "Updated Title",
      summary: "Updated summary",
    });

    const putJsonMock = writer.putJson as ReturnType<typeof vi.fn>;
    const putCalls = putJsonMock.mock.calls;
    expect(putCalls).toHaveLength(2);

    // Check index has new entry first and no duplicates
    const call2 = putCalls[1];
    expect(call2).toBeDefined();
    if (call2) {
      const [, index] = call2;
      const indexData = index as Record<string, unknown>;
      const replays = indexData.replays as Array<Record<string, unknown>>;
      expect(replays).toHaveLength(2);
      expect(replays[0]).toMatchObject({
        id: "pr-99-2026-07-25",
        title: "Updated Title",
        summary: "Updated summary",
      });
      expect(replays[1]).toMatchObject({
        id: "pr-98-2026-07-24",
        title: "other PR",
      });
    }

    consoleLogSpy.mockRestore();
  });
});
