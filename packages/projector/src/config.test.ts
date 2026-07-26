import { describe, expect, it } from "vitest";
import { readConfig } from "./config.js";

const base = {
  NATS_SERVERS: "nats://n1:4222,nats://n2:4222",
  NATS_STREAM: "EVENTS",
  NATS_DURABLE: "observatory-projector",
  NATS_FILTER_SUBJECTS:
    "gh.event.dungeonadventures.>,dungeonadventures.event.merge_decision.reached.>",
  R2_ACCOUNT_ID: "acct",
  R2_BUCKET: "observatory",
  R2_ACCESS_KEY_ID: "k",
  R2_SECRET_ACCESS_KEY: "s",
};

describe("readConfig", () => {
  it("parses a complete env", () => {
    const cfg = readConfig(base);
    expect(cfg.natsServers).toEqual(["nats://n1:4222", "nats://n2:4222"]);
    expect(cfg.filterSubjects).toHaveLength(2);
    expect(cfg.pushEnabled).toBe(true); // default on
  });
  it("OBSERVATORY_PUSH_ENABLED=false is the kill switch", () => {
    expect(readConfig({ ...base, OBSERVATORY_PUSH_ENABLED: "false" }).pushEnabled).toBe(false);
  });
  it("throws on missing required vars", () => {
    const { NATS_SERVERS: _, ...rest } = base;
    expect(() => readConfig(rest)).toThrow(/NATS_SERVERS/);
  });
});
