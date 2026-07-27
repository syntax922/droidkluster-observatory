import { describe, expect, it } from "vitest";
import { JOURNEY_H, JOURNEY_W, journeyFrame } from "./journey-frame.js";

const NONE = [false, false, false, false, false, false];
const ROW_Y = Math.floor(JOURNEY_H / 2);

describe("journeyFrame", () => {
  it("is deterministic for identical inputs", () => {
    const a = journeyFrame(2.3, NONE, [1, 1.5], 4200);
    const b = journeyFrame(2.3, NONE, [1, 1.5], 4200);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("places the traveling dot at the first station's x for position 0, t=0", () => {
    const f = journeyFrame(0, NONE, [], 0);
    expect(f[ROW_Y * JOURNEY_W + 12]).toBe(3);
  });

  it("places the traveling dot at the last station's x for position 5, t=0", () => {
    const f = journeyFrame(5, NONE, [], 0);
    expect(f[ROW_Y * JOURNEY_W + 180]).toBe(3);
  });

  it("never exceeds intensity level 3", () => {
    const f = journeyFrame(2.5, [true, true, false, true, false, true], [0.5, 1.2, 3.8], 9999);
    expect(Math.max(...f)).toBeLessThanOrEqual(3);
  });

  it("a visited station renders differently from an unvisited one", () => {
    const unvisited = journeyFrame(3, NONE, [], 500);
    const visited = journeyFrame(3, [true, false, false, false, false, false], [], 500);
    // Station 0 sits at x=12: unvisited leaves a single center dot, visited
    // adds the diamond outline points above/below the row.
    expect(unvisited[(ROW_Y - 1) * JOURNEY_W + 12]).toBe(0);
    expect(visited[(ROW_Y - 1) * JOURNEY_W + 12]).toBe(2);
    expect(Array.from(unvisited)).not.toEqual(Array.from(visited));
  });

  it("frame length matches JOURNEY_W * JOURNEY_H", () => {
    const f = journeyFrame(0, NONE, [], 0);
    expect(f.length).toBe(JOURNEY_W * JOURNEY_H);
  });

  describe("dimmed (stale/idle honesty idiom)", () => {
    it("is static: identical output at different tMs (no pulse animation)", () => {
      const a = journeyFrame(3, [true, false, false, false, false, false], [], 0, true);
      const b = journeyFrame(3, [true, false, false, false, false, false], [], 500, true);
      expect(Array.from(a)).toEqual(Array.from(b));
    });

    it("renders the dot at intensity 2, not 3", () => {
      const f = journeyFrame(0, NONE, [], 0, true);
      expect(f[ROW_Y * JOURNEY_W + 12]).toBe(2);
    });

    it("collapses the visited/unvisited station distinction to a flat intensity-1 dot", () => {
      const visited = journeyFrame(3, [true, false, false, false, false, false], [], 500, true);
      const unvisited = journeyFrame(3, NONE, [], 500, true);
      // Station 0's diamond-outline points (above/below the row) are absent
      // when dimmed, even though it's visited — unlike the non-dimmed case.
      expect(visited[(ROW_Y - 1) * JOURNEY_W + 12]).toBe(0);
      expect(visited[ROW_Y * JOURNEY_W + 12]).toBe(1);
      expect(Array.from(visited)).toEqual(Array.from(unvisited));
    });

    it("defaults to non-dimmed when the parameter is omitted", () => {
      const withDefault = journeyFrame(0, NONE, [], 0);
      const explicitFalse = journeyFrame(0, NONE, [], 0, false);
      expect(Array.from(withDefault)).toEqual(Array.from(explicitFalse));
    });
  });
});
