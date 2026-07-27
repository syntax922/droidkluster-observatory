import { describe, expect, it } from "vitest";
import { humanAge, offsetLabel, spanLabel } from "./time.js";

describe("humanAge", () => {
  it("shows seconds under the 90s ceiling", () => {
    expect(humanAge(0)).toBe("0s");
    expect(humanAge(1_000)).toBe("1s");
    expect(humanAge(89_000)).toBe("89s");
  });
  it("rolls over to minutes at the 90s boundary", () => {
    // 90s = 1.5m, rounds up to 2m — the boundary belongs to the next unit.
    expect(humanAge(90_000)).toBe("2m");
    expect(humanAge(3 * 60_000)).toBe("3m");
    expect(humanAge(41 * 60_000)).toBe("41m");
  });
  it("rolls over to hours at the 90m boundary", () => {
    expect(humanAge(89 * 60_000)).toBe("89m");
    expect(humanAge(90 * 60_000)).toBe("2h");
    expect(humanAge(2 * 60 * 60_000)).toBe("2h");
    // The old honesty.ts age() had no ceiling on minutes and would have
    // shown "180m ago" forever; humanAge scales this to "3h".
    expect(humanAge(3 * 60 * 60_000)).toBe("3h");
  });
  it("rolls over to days at the 36h boundary", () => {
    expect(humanAge(35 * 60 * 60_000)).toBe("35h");
    expect(humanAge(36 * 60 * 60_000)).toBe("2d");
    expect(humanAge(47 * 60 * 60_000)).toBe("2d");
  });
  it("clamps negative durations to 0s", () => {
    expect(humanAge(-1)).toBe("0s");
    expect(humanAge(-999_999)).toBe("0s");
  });
});

describe("offsetLabel", () => {
  it("prefixes humanAge with a +", () => {
    expect(offsetLabel("2026-07-25T13:00:00Z", "2026-07-25T13:00:00Z")).toBe("+0s");
    expect(offsetLabel("2026-07-25T13:00:00Z", "2026-07-25T13:03:00Z")).toBe("+3m");
    expect(offsetLabel("2026-07-25T13:00:00Z", "2026-07-25T13:41:00Z")).toBe("+41m");
    expect(offsetLabel("2026-07-25T13:00:00Z", "2026-07-25T15:00:00Z")).toBe("+2h");
  });
  it("clamps an at before start to +0s", () => {
    expect(offsetLabel("2026-07-25T13:00:00Z", "2026-07-25T12:59:00Z")).toBe("+0s");
  });
});

describe("spanLabel", () => {
  it("humanizes the span between first and last", () => {
    expect(spanLabel("2026-07-25T13:00:00Z", "2026-07-25T13:41:00Z")).toBe("41m");
    expect(spanLabel("2026-07-23T13:00:00Z", "2026-07-25T13:00:00Z")).toBe("2d");
  });
});
