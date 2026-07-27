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

function accentFor(droid: DroidId | "system"): string {
  return droid === "system" ? SYSTEM_ACCENT : ACCENTS[droid];
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
    const droidTag = document.createElement("span");
    droidTag.className = "tl-droid";
    droidTag.style.color = accent;
    droidTag.textContent = DROID_REGISTRY[hop.droid].name;
    row.appendChild(droidTag);
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

function buildTimeline(
  chain: Chain,
  excerptsFor: ((pr: number) => Map<string, string>) | undefined,
): HTMLElement {
  const timeline = document.createElement("div");
  timeline.className = "timeline";
  const excerptMap = excerptsFor?.(chain.pr);
  const firstAt = chain.hops[0]?.at ?? chain.updated_at;

  chain.hops.forEach((hop, i) => {
    const prevHop = chain.hops[i - 1];
    if (prevHop) {
      const gapMs = Date.parse(hop.at) - Date.parse(prevHop.at);
      if (gapMs > GAP_THRESHOLD_MS) timeline.appendChild(buildGapRow(gapMs));
    }
    const excerpt = excerptMap?.get(`${hop.kind}|${hop.at}`);
    const isNow = chain.active && i === chain.hops.length - 1;
    timeline.appendChild(buildHopRow(hop, { firstAt, isNow, excerpt }));
  });

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
