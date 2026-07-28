import { describe, expect, it } from "vitest";
import { readConfig, readR2Config } from "./config.js";

const base = {
  NATS_SERVERS: "nats://n1:4222,nats://n2:4222",
  NATS_STREAM: "EVENTS",
  NATS_DURABLE: "observatory-projector",
  NATS_FILTER_SUBJECTS: "gh.event.exampleproj.>,exampleproj.event.merge_decision.reached.>",
  R2_ACCOUNT_ID: "acct",
  R2_BUCKET: "observatory",
  R2_ACCESS_KEY_ID: "k",
  R2_SECRET_ACCESS_KEY: "s",
  OBSERVATORY_SOURCE_REPO: "exampleproj",
};

describe("readConfig", () => {
  it("parses a complete env", () => {
    const cfg = readConfig(base);
    expect(cfg.natsServers).toEqual(["nats://n1:4222", "nats://n2:4222"]);
    expect(cfg.filterSubjects).toHaveLength(2);
    expect(cfg.pushEnabled).toBe(true); // default on
  });
  it("OBSERVATORY_IGNORE_PRS defaults to the fleet canary (99999)", () => {
    const cfg = readConfig(base);
    expect(cfg.ignorePrs).toEqual(new Set([99999]));
  });
  it("OBSERVATORY_IGNORE_PRS parses a custom csv of ints", () => {
    const cfg = readConfig({ ...base, OBSERVATORY_IGNORE_PRS: "99999, 88888,1" });
    expect(cfg.ignorePrs).toEqual(new Set([99999, 88888, 1]));
  });
  it("OBSERVATORY_IGNORE_PRS throws on a non-integer entry", () => {
    expect(() => readConfig({ ...base, OBSERVATORY_IGNORE_PRS: "99999,abc" })).toThrow(
      /OBSERVATORY_IGNORE_PRS/,
    );
  });
  it("OBSERVATORY_PUSH_ENABLED=false is the kill switch", () => {
    expect(readConfig({ ...base, OBSERVATORY_PUSH_ENABLED: "false" }).pushEnabled).toBe(false);
  });
  it("throws on missing required vars", () => {
    const { NATS_SERVERS: _, ...rest } = base;
    expect(() => readConfig(rest)).toThrow(/NATS_SERVERS/);
  });
  it("throws on a non-numeric PUSH_DEBOUNCE_MS", () => {
    expect(() => readConfig({ ...base, PUSH_DEBOUNCE_MS: "abc" })).toThrow(/PUSH_DEBOUNCE_MS/);
  });
  it("filters empty entries from a trailing-comma NATS_SERVERS", () => {
    const cfg = readConfig({ ...base, NATS_SERVERS: "nats://n1:4222," });
    expect(cfg.natsServers).toEqual(["nats://n1:4222"]);
  });
  it("throws on missing OBSERVATORY_SOURCE_REPO", () => {
    const { OBSERVATORY_SOURCE_REPO: _, ...rest } = base;
    expect(() => readConfig(rest)).toThrow(/required env var OBSERVATORY_SOURCE_REPO not set/);
  });
  it("OBSERVATORY_REDACT_TERMS defaults to an empty array when unset", () => {
    const cfg = readConfig(base);
    expect(cfg.redactTerms).toEqual([]);
  });
  it("OBSERVATORY_REDACT_TERMS parses a trimmed, empty-filtered csv", () => {
    const cfg = readConfig({ ...base, OBSERVATORY_REDACT_TERMS: "a, b ,,c" });
    expect(cfg.redactTerms).toEqual(["a", "b", "c"]);
  });
});

describe("readR2Config", () => {
  it("succeeds with only the four R2 vars set — no NATS_* required", () => {
    const r2 = readR2Config({
      R2_ACCOUNT_ID: "acct",
      R2_BUCKET: "observatory",
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
    });
    expect(r2).toEqual({
      accountId: "acct",
      bucket: "observatory",
      accessKeyId: "k",
      secretAccessKey: "s",
    });
  });
  it("throws on a missing R2 var", () => {
    expect(() => readR2Config({ R2_ACCOUNT_ID: "acct" })).toThrow(/R2_BUCKET/);
  });
});
