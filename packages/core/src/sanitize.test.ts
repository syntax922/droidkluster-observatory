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
  it("html comment plumbing prefix is stripped entirely", () => {
    const dirty =
      "<!-- hs:command_id=0197dd23-d5f3-5a35-867d-477293c91595 --> Statement: the work is adequate.";
    const out = scrubExcerpt(dirty);
    expect(out).toMatch(/^Statement:/);
  });
  it("truncates to EXCERPT_MAX_LEN with ellipsis", () => {
    const long = "a".repeat(1000);
    const out = scrubExcerpt(long);
    expect(out.length).toBeLessThanOrEqual(EXCERPT_MAX_LEN);
    expect(out.endsWith("…")).toBe(true);
  });
  it("bounds input with PRE_CAP to guard quadratic backtracking", () => {
    const huge = "a.b ".repeat(20000);
    const out = scrubExcerpt(huge);
    expect(out.length).toBeLessThanOrEqual(EXCERPT_MAX_LEN);
  });
});

describe("redact terms", () => {
  it("replaces a term case-insensitively with [project]", () => {
    expect(scrubExcerpt("The ExampleProj repo and exampleproj CI", ["exampleproj"])).toBe(
      "The [project] repo and [project] CI",
    );
  });

  it("replaces multiple terms independently", () => {
    expect(scrubExcerpt("acme-org owns acme-workers", ["acme-org", "acme-workers"])).toBe(
      "[project] owns [project]",
    );
  });

  it("defaults to no term redaction", () => {
    expect(scrubExcerpt("plain prose stays")).toBe("plain prose stays");
  });

  it("never touches the droidkluster brand unless explicitly listed", () => {
    expect(scrubExcerpt("droidkluster fleet works on exampleproj", ["exampleproj"])).toBe(
      "droidkluster fleet works on [project]",
    );
  });

  it("escapes regex metacharacters in terms", () => {
    expect(scrubExcerpt("repo a.b+c here", ["a.b+c"])).toBe("repo [project] here");
    // The dot must not act as a wildcard:
    expect(scrubExcerpt("axb+c untouched", ["a.b+c"])).toBe("axb+c untouched");
  });

  it("kill rules still run first: a term inside a URL is already gone", () => {
    expect(scrubExcerpt("see https://github.com/acme-org/x for it", ["acme-org"])).toBe(
      "see [redacted] for it",
    );
  });
});
