import type { PublicEvent } from "@observatory/core";

export function renderTicker(el: HTMLElement, events: PublicEvent[]): void {
  el.replaceChildren();
  const newest = [...events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
  for (const e of newest) {
    const line = document.createElement("div");
    line.className = "tick";
    const main = document.createElement("span");
    main.textContent = `${e.at.slice(11, 19)} · ${e.droid} · ${e.summary}`;
    line.appendChild(main);
    if (e.excerpt) {
      const ex = document.createElement("div");
      ex.className = "tick-excerpt";
      ex.textContent = e.excerpt;
      line.appendChild(ex);
    }
    el.appendChild(line);
  }
}
