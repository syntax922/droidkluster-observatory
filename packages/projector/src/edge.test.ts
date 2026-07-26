import { describe, expect, it, vi } from "vitest";
import { EdgeWriter } from "./edge.js";

describe("EdgeWriter", () => {
  it("PUTs JSON with content-type and cache-control", async () => {
    const w = new EdgeWriter({
      accountId: "acct",
      bucket: "obs",
      accessKeyId: "k",
      secretAccessKey: "s",
    });
    const send = vi.fn().mockResolvedValue({});
    // @ts-expect-error test seam: replace the private client
    w.client = { send };
    await w.putJson("current.json", { ok: true }, 15);
    const cmd = send.mock.calls[0]?.[0];
    expect(cmd.input).toMatchObject({
      Bucket: "obs",
      Key: "current.json",
      ContentType: "application/json",
      CacheControl: "public, max-age=15",
    });
    expect(JSON.parse(cmd.input.Body as string)).toEqual({ ok: true });
  });
});
