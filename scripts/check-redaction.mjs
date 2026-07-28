#!/usr/bin/env node
// Mechanism-only redaction gate (issue #42).
//
// This script deliberately contains no real-world subject names — it only
// knows about the two public, neutral tokens ("project" for the site replay,
// "exampleproj" for package tests). It cannot enumerate or reference a
// private repo/org name, because none exists in this public repo. A
// companion scheduled grep for the actual private-side term list lives in
// the private GitOps repo, not here.
//
// Two checks:
//   1. Presence: packages/site/src/replay.ts genuinely wires the neutral
//      "project" token into its `gh.event.` subject construction (so check
//      #2 below isn't vacuously true because nobody uses `gh.event.` at all).
//   2. Absence: no `.ts` file under packages/ contains a `gh.event.` subject
//      literal other than the neutral tokens or a template placeholder.
//
// Runs pre-minification, directly against source, so it can't be defeated
// by bundler string-hoisting or minifier renaming.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PACKAGES_DIR = join(ROOT, "packages");
const REPLAY_FILE = join(PACKAGES_DIR, "site", "src", "replay.ts");

const EXCLUDED_DIRS = new Set(["node_modules", "dist", "test-results"]);

/** @param {string} dir @returns {string[]} */
function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

let failed = false;

// --- Check 1: presence of the neutral token, wired into gh.event subjects ---
const replaySource = readFileSync(REPLAY_FILE, "utf8");
const hasNeutralAssignment = /REPLAY_REPO\s*=\s*"project"/.test(replaySource);
const hasTemplateWiring = /gh\.event\.\$\{REPLAY_REPO\}/.test(replaySource);

if (!hasNeutralAssignment || !hasTemplateWiring) {
  failed = true;
  const expected =
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder text, not an interpolation.
    'expected REPLAY_REPO = "project" used as the gh.event.${REPLAY_REPO}. template prefix';
  console.error(
    `[redaction-gate] FAIL: ${relative(ROOT, REPLAY_FILE)} no longer wires the neutral "project" token into its gh.event.* subjects (${expected}).`,
  );
}

// --- Check 2: absence of any foreign subject literal under packages/ ---
// Matches `gh.event.` NOT followed by the neutral "project.", the test
// fixture "exampleproj.", or a template placeholder "${".
const FOREIGN_SUBJECT = /gh\.event\.(?!project\.|exampleproj\.|\$\{)/g;

for (const file of listTsFiles(PACKAGES_DIR)) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Strip a trailing `//` line comment before scanning: this gate checks
    // literal subject values that ship in the bundle, not prose in doc
    // comments (e.g. a schema comment like `gh.event.<repo>.<entity>...`).
    const codePart = line.split("//")[0] ?? "";
    FOREIGN_SUBJECT.lastIndex = 0;
    if (FOREIGN_SUBJECT.test(codePart)) {
      failed = true;
      console.error(
        `[redaction-gate] FAIL: ${relative(ROOT, file)}:${i + 1}: foreign gh.event.* subject literal: ${line.trim()}`,
      );
    }
  }
}

if (failed) {
  console.error(
    '[redaction-gate] A gh.event.* subject must use the neutral "project" (site) or ' +
      '"exampleproj" (tests) token, or a template placeholder — never a real repo/org name.',
  );
  process.exit(1);
}

console.log("[redaction-gate] OK: neutral token present, no foreign gh.event.* subject literals.");
