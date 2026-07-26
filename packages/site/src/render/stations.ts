import type { DroidStatus } from "@observatory/core";
import { DROID_REGISTRY } from "../registry.js";

export function renderStations(el: HTMLElement, droids: DroidStatus[], nowMs: number): void {
  el.replaceChildren();
  for (const d of droids) {
    const info = DROID_REGISTRY[d.droid];
    const card = document.createElement("button");
    card.className = `station station--${d.state}`;
    card.dataset.droid = d.droid;
    const elapsed = d.since ? Math.max(0, Math.round((nowMs - Date.parse(d.since)) / 1000)) : null;

    // Create name span
    const nameSpan = document.createElement("span");
    nameSpan.className = "station-name";
    nameSpan.textContent = info.name;
    card.appendChild(nameSpan);

    // Create role span
    const roleSpan = document.createElement("span");
    roleSpan.className = "station-role";
    roleSpan.textContent = info.role;
    card.appendChild(roleSpan);

    // Create status span with textContent (security: avoid XSS from d.task/d.last_action)
    const statusSpan = document.createElement("span");
    statusSpan.className = "station-status";
    if (d.state === "active" && d.task) {
      const taskText = d.task.toUpperCase();
      const elapsedText = elapsed !== null ? ` — ${elapsed}s` : "";
      statusSpan.textContent = taskText + elapsedText;
    } else {
      const idleText = "IDLE";
      const lastText = d.last_action ? ` · last: ${d.last_action}` : "";
      statusSpan.textContent = idleText + lastText;
    }
    card.appendChild(statusSpan);

    const dmd = document.createElement("canvas");
    dmd.className = "station-dmd";
    dmd.dataset.dmd = d.droid;
    dmd.width = 192;
    dmd.height = 96;
    card.appendChild(dmd);

    el.appendChild(card);
  }
}
