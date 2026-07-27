import type { Chain, ChainHop, DroidId } from "@observatory/core";
import { ACCENTS } from "../dmd/palette.js";
import { DROID_REGISTRY } from "../registry.js";
import { humanAge, offsetLabel } from "../time.js";

// System hops (PR opened, PR merged, CI results attributed to no droid) get
// a dim neutral dot rather than an accent color — this is the same value as
// --dim in style.css, kept as a literal here because chains.ts renders via
// inline styles (deterministic under jsdom, no computed-style lookups).
const SYSTEM_ACCENT = "#6b7789";

// Hops more than this far apart in real time get a dashed "+Nm later" gap
// row between them, so a long quiet stretch reads as a pause, not as two
// hops that just happened to land next to each other in the list.
const GAP_THRESHOLD_MS = 10 * 60 * 1000;

// A run of this many-or-more consecutive system check_run hops collapses
// into a single summary row. Below this threshold each hop still tells its
// own story; at and above it, the run is noise a reader has to scroll past
// rather than a narrative beat — see the "CI checks" batch row below.
const BATCH_MIN_RUN = 3;

function accentFor(droid: DroidId | "system"): string {
  return droid === "system" ? SYSTEM_ACCENT : ACCENTS[droid];
}

// Only droid-less, system-attributed check_run hops are candidates for
// batching. A check_run hop attributed to 2-1B (i.e. a CI-red failure the
// surgeon is now diagnosing) is a narrative beat, not noise, and must never
// batch — this filter is what keeps that guarantee true by construction.
function isBatchableCheckRun(hop: ChainHop): boolean {
  return hop.droid === "system" && hop.kind === "check_run";
}

// Parses the conclusion word out of a system check_run label's "CI <word> ("
// prefix (e.g. "CI skipped (lint) · PR #42" -> "skipped"). Labels that don't
// match the expected shape count as "completed" rather than being dropped.
function conclusionWord(label: string): string {
  return /^CI (\w+) \(/.exec(label)?.[1] ?? "completed";
}

// "12 CI checks · 7 skipped, 5 cancelled" — distinct conclusion words with
// their counts, most common first (alphabetical tiebreak for determinism).
function summarizeConclusions(hops: ChainHop[]): string {
  const counts = new Map<string, number>();
  for (const hop of hops) {
    const word = conclusionWord(hop.label);
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([wa, ca], [wb, cb]) => cb - ca || wa.localeCompare(wb))
    .map(([word, count]) => `${count} ${word}`)
    .join(", ");
}

// A single hop, or a run of >= BATCH_MIN_RUN consecutive batchable check_run
// hops collapsed for display. Grouping happens on array adjacency AND real
// time proximity — the underlying hops (and therefore engine/reducer state)
// are untouched; this only changes how the timeline renders them.
type HopUnit = { kind: "hop"; hop: ChainHop } | { kind: "batch"; hops: ChainHop[] };

function groupHopUnits(hops: ChainHop[]): HopUnit[] {
  const units: HopUnit[] = [];
  let i = 0;
  while (i < hops.length) {
    const hop = hops[i];
    if (hop && isBatchableCheckRun(hop)) {
      let j = i + 1;
      while (j < hops.length) {
        const next = hops[j];
        const prev = hops[j - 1];
        if (!next || !isBatchableCheckRun(next)) break;
        // A run only holds together while consecutive hops stay within the
        // same gap threshold that governs the between-units .tl-gap row
        // elsewhere in this file — otherwise a batch would silently swallow
        // a quiet stretch a reader should see as a pause. Splitting here
        // (rather than special-casing the batch renderer) means the run
        // boundary itself produces the gap row for free, via the existing
        // between-units gap check in buildTimeline.
        if (prev && Date.parse(next.at) - Date.parse(prev.at) > GAP_THRESHOLD_MS) break;
        j++;
      }
      const run = hops.slice(i, j);
      if (run.length >= BATCH_MIN_RUN) {
        units.push({ kind: "batch", hops: run });
        i = j;
        continue;
      }
    }
    if (hop) units.push({ kind: "hop", hop });
    i++;
  }
  return units;
}

function statusWord(c: Chain): "active" | "complete" | "quiet" {
  if (c.complete) return "complete";
  if (c.active) return "active";
  return "quiet";
}

// Active chains surface first regardless of recency, then the rest read
// newest-first — the story rail should lead with what's happening now.
function orderChains(chains: Chain[]): Chain[] {
  return [...chains].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return b.updated_at.localeCompare(a.updated_at);
  });
}

function buildGapRow(gapMs: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "tl-gap";
  row.textContent = `+${humanAge(gapMs)} later`;
  return row;
}

function buildHopRow(
  hop: ChainHop,
  opts: { firstAt: string; isNow: boolean; excerpt: string | undefined },
): HTMLElement {
  const accent = accentFor(hop.droid);

  const row = document.createElement("div");
  row.className = "tl-row";

  const node = document.createElement("span");
  node.className = opts.isNow ? "tl-node tl-now" : "tl-node";
  node.style.backgroundColor = accent;
  node.style.color = accent; // drives the .tl-now pulse ring via currentColor
  row.appendChild(node);

  const time = document.createElement("span");
  time.className = "tl-time";
  time.textContent = offsetLabel(opts.firstAt, hop.at);
  row.appendChild(time);

  if (hop.droid !== "system") {
    const droidName = DROID_REGISTRY[hop.droid].name;
    // The label already carries attribution when it opens with the droid's
    // own name (e.g. "HK-47 review started · PR #1663", or lowercased as in
    // "copilot session started · PR #42" against registry name "Copilot")
    // — showing the .tl-droid tag on top of that repeats the name for no
    // reason. Case-insensitive because reducer-authored labels don't always
    // match the registry's display casing. Labels that don't lead with the
    // name (e.g. "review CHANGES_REQUESTED · PR #1663") still need the tag
    // as the only source of attribution.
    const labelLeadsWithName = hop.label.toLowerCase().startsWith(`${droidName.toLowerCase()} `);
    if (!labelLeadsWithName) {
      const droidTag = document.createElement("span");
      droidTag.className = "tl-droid";
      droidTag.style.color = accent;
      droidTag.textContent = droidName;
      row.appendChild(droidTag);
    }
  }

  const label = document.createElement("span");
  label.className = "tl-label";
  label.textContent = hop.label;
  row.appendChild(label);

  if (opts.excerpt !== undefined) {
    const card = document.createElement("div");
    card.className = "tl-excerpt";
    card.style.borderLeftColor = accent;
    card.textContent = opts.excerpt;
    card.title = opts.excerpt;
    row.appendChild(card);
  }

  return row;
}

// Renders a collapsed run of >= BATCH_MIN_RUN consecutive system check_run
// hops as one dim, neutral row: "{n} CI checks · {conclusion summary}". No
// droid tag (these are all system hops, same as the un-batched case), no
// excerpt card (check_run hops never carry one), and no title attribute —
// the label text is the whole story here, nothing extra to surface on hover.
function buildBatchRow(hops: ChainHop[], firstAt: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "tl-row";

  const node = document.createElement("span");
  node.className = "tl-node";
  node.style.backgroundColor = SYSTEM_ACCENT;
  node.style.color = SYSTEM_ACCENT;
  row.appendChild(node);

  const runStart = hops[0];
  const time = document.createElement("span");
  time.className = "tl-time";
  time.textContent = runStart ? offsetLabel(firstAt, runStart.at) : "";
  row.appendChild(time);

  const label = document.createElement("span");
  label.className = "tl-label";
  label.textContent = `${hops.length} CI checks · ${summarizeConclusions(hops)}`;
  row.appendChild(label);

  return row;
}

function buildTimeline(
  chain: Chain,
  excerptsFor: ((pr: number) => Map<string, string>) | undefined,
): HTMLElement {
  const timeline = document.createElement("div");
  timeline.className = "timeline";
  const excerptMap = excerptsFor?.(chain.pr);
  const firstAt = chain.hops[0]?.at ?? chain.updated_at;
  const lastHop = chain.hops[chain.hops.length - 1];

  let prevAt: string | undefined;
  for (const unit of groupHopUnits(chain.hops)) {
    const unitFirstAt = unit.kind === "batch" ? unit.hops[0]?.at : unit.hop.at;
    if (prevAt !== undefined && unitFirstAt !== undefined) {
      const gapMs = Date.parse(unitFirstAt) - Date.parse(prevAt);
      if (gapMs > GAP_THRESHOLD_MS) timeline.appendChild(buildGapRow(gapMs));
    }

    if (unit.kind === "batch") {
      timeline.appendChild(buildBatchRow(unit.hops, firstAt));
      prevAt = unit.hops[unit.hops.length - 1]?.at;
    } else {
      const hop = unit.hop;
      const excerpt = excerptMap?.get(`${hop.kind}|${hop.at}`);
      const isNow = chain.active && hop === lastHop;
      timeline.appendChild(buildHopRow(hop, { firstAt, isNow, excerpt }));
      prevAt = hop.at;
    }
  }

  return timeline;
}

export function renderChains(
  el: HTMLElement,
  chains: Chain[],
  excerptsFor?: (pr: number) => Map<string, string>,
): void {
  el.replaceChildren();
  if (chains.length === 0) {
    const p = document.createElement("p");
    p.className = "chains-empty";
    p.textContent = "no active chains";
    el.appendChild(p);
    return;
  }
  for (const c of orderChains(chains)) {
    const chainEl = document.createElement("div");
    chainEl.className = `chain${c.active ? " chain--active" : ""}${c.complete ? " chain--complete" : ""}`;

    const head = document.createElement("div");
    head.className = "chain-head";
    head.textContent = `PR #${c.pr} · ${statusWord(c)}`;
    chainEl.appendChild(head);

    chainEl.appendChild(buildTimeline(c, excerptsFor));
    el.appendChild(chainEl);
  }
}
