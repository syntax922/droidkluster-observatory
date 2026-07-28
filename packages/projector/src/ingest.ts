// Converts a PRIVATE build-window recording (JSONL of canon envelopes) into
// sanitized public replay bundles. Sanitization is inherited: every event is
// produced by the same reducer the live projector uses, so excerpts pass
// through scrubExcerpt and only PublicEvent fields survive.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type CanonEnvelope, emptyFleetState, ReplayBundleSchema, reduce } from "@observatory/core";

const MIN_EVENTS = 3;

// Same default as the live projector's OBSERVATORY_IGNORE_PRS (config.ts) —
// keeps the fleet's synthetic canary PR out of future inaugural replay
// bundles even when ingest.js is run standalone without that env var.
const DEFAULT_IGNORE_PRS: ReadonlySet<number> = new Set([99999]);

// Mirrors reduce()'s ReduceOpts — repo is required (no safe default: unlike
// ignorePrs, a wrong fallback here would silently no-op every real
// recording rather than fail loudly), ignorePrs/redactTerms stay optional.
export interface IngestOpts {
  repo: string;
  ignorePrs?: ReadonlySet<number>;
  redactTerms?: readonly string[];
}

export function ingest(inputPath: string, outDir: string, opts: IngestOpts): string[] {
  const ignorePrs = opts.ignorePrs ?? DEFAULT_IGNORE_PRS;
  const state = emptyFleetState();
  for (const line of readFileSync(inputPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line) as Partial<CanonEnvelope>;
      if (raw.kind !== "event" || typeof raw.subject !== "string" || typeof raw.id !== "string")
        continue;
      reduce(
        state,
        {
          kind: "event",
          id: raw.id,
          subject: raw.subject,
          ...(typeof raw.ts === "string" ? { ts: raw.ts } : {}),
          payload: raw.payload,
        },
        {
          repo: opts.repo,
          ignorePrs,
          ...(opts.redactTerms ? { redactTerms: opts.redactTerms } : {}),
        },
      );
    } catch {
      // Malformed recorder line: skip; the recording is best-effort.
    }
  }

  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const chain of state.chains.values()) {
    if (chain.events.length < MIN_EVENTS) continue;
    const last = chain.events[chain.events.length - 1];
    if (!last) continue;
    const date = last.at.slice(0, 10);
    const id = `pr-${chain.pr}-${date}`;
    const bundle = ReplayBundleSchema.parse({
      id,
      title: `PR #${chain.pr} lifecycle`,
      captured_on: date,
      pr: chain.pr,
      events: chain.events,
    });
    writeFileSync(join(outDir, `${id}.json`), JSON.stringify(bundle, null, 2));
    written.push(`${id}.json`);
  }
  return written.sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { input: { type: "string" }, out: { type: "string" } } });
  if (!values.input || !values.out) {
    console.error("usage: ingest.js --input <recording.jsonl> --out <dir>");
    process.exit(2);
  }
  // Same env var the live projector reads via readConfig() (config.ts) —
  // ingest.js runs standalone (no NATS_*/R2_* required), so it reads this
  // one var directly rather than pulling in the full projector config.
  const repo = process.env.OBSERVATORY_SOURCE_REPO;
  if (!repo) {
    console.error("required env var OBSERVATORY_SOURCE_REPO not set");
    process.exit(2);
  }
  const redactTerms = (process.env.OBSERVATORY_REDACT_TERMS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const files = ingest(values.input, values.out, { repo, redactTerms });
  console.log(`wrote ${files.length} bundle(s): ${files.join(", ")}`);
}
