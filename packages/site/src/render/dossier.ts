import type { DroidId } from "@observatory/core";
import { DROID_REGISTRY } from "../registry.js";

export function renderDossier(el: HTMLElement, droid: DroidId): void {
  const info = DROID_REGISTRY[droid];
  el.replaceChildren();
  el.className = "dossier";
  const h = document.createElement("h2");
  h.textContent = info.name;
  const role = document.createElement("p");
  role.className = "dossier-role";
  role.textContent = `${info.role} · ${info.model}`;
  el.append(h, role);
  const list = document.createElement("ul");
  for (const line of info.doctrine) {
    const li = document.createElement("li");
    li.className = "doctrine-line";
    li.textContent = line;
    list.appendChild(li);
  }
  el.appendChild(list);
}
