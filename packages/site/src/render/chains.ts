import type { Chain } from "@observatory/core";

function hhmm(iso: string): string {
  return iso.slice(11, 16);
}

export function renderChains(el: HTMLElement, chains: Chain[]): void {
  el.replaceChildren();
  if (chains.length === 0) {
    const p = document.createElement("p");
    p.className = "chains-empty";
    p.textContent = "no active chains";
    el.appendChild(p);
    return;
  }
  for (const c of chains) {
    const row = document.createElement("div");
    row.className = `chain${c.active ? " chain--active" : ""}${c.complete ? " chain--complete" : ""}`;
    const head = document.createElement("div");
    head.className = "chain-head";
    head.textContent = `PR #${c.pr}${c.complete ? " · complete" : ""}`;
    row.appendChild(head);
    const track = document.createElement("div");
    track.className = "chain-track";
    for (const h of c.hops) {
      const hop = document.createElement("span");
      hop.className = `hop hop--${h.droid}`;
      hop.textContent = `${hhmm(h.at)} ${h.label}`;
      track.appendChild(hop);
    }
    row.appendChild(track);
    el.appendChild(row);
  }
}
