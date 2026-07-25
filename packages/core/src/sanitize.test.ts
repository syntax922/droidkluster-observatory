import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXCERPT_MAX_LEN, scrubExcerpt } from "./sanitize.js";

interface CorpusEntry {
  name: string;
  dirty: string;
  mustNotContain: string[];
}
const corpusPath = fileURLToPath(new URL("../corpus/dirty-excerpts.json", import.meta.url));
const corpus: CorpusEntry[] = JSON.parse(readFileSync(corpusPath, "utf8"));

describe("scrubExcerpt corpus", () => {
  for (const entry of corpus) {
    it(`kills: ${entry.name}`, () => {
      const out = scrubExcerpt(entry.dirty);
      for (const banned of entry.mustNotContain) {
        expect(out).not.toContain(banned);
      }
    });
  }
  it("clean prose passes through unchanged", () => {
    const clean =
      "Finding: the retry loop swallows the terminal error class instead of rethrowing it.";
    expect(scrubExcerpt(clean)).toBe(clean);
  });
  it("truncates to EXCERPT_MAX_LEN with ellipsis", () => {
    const long = "a".repeat(1000);
    const out = scrubExcerpt(long);
    expect(out.length).toBeLessThanOrEqual(EXCERPT_MAX_LEN);
    expect(out.endsWith("…")).toBe(true);
  });
});
