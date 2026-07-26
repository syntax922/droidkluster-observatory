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

  // Specification section
  const spec = info.specification;
  const specTag = document.createElement("p");
  specTag.className = "spec-tag";
  specTag.textContent = `abstracted from production — revised ${spec.revised}`;
  el.appendChild(specTag);

  // Observes section
  const observesH = document.createElement("h3");
  observesH.textContent = "Observes";
  el.appendChild(observesH);
  const observesList = document.createElement("ul");
  for (const line of spec.observes) {
    const li = document.createElement("li");
    li.className = "spec-line";
    li.textContent = line;
    observesList.appendChild(li);
  }
  el.appendChild(observesList);

  // Upholds section
  const upholdsH = document.createElement("h3");
  upholdsH.textContent = "Upholds";
  el.appendChild(upholdsH);
  const upholdsList = document.createElement("ul");
  for (const line of spec.upholds) {
    const li = document.createElement("li");
    li.className = "spec-line";
    li.textContent = line;
    upholdsList.appendChild(li);
  }
  el.appendChild(upholdsList);

  // Emits section
  const emitsH = document.createElement("h3");
  emitsH.textContent = "Emits";
  el.appendChild(emitsH);
  const emitsList = document.createElement("ul");
  for (const line of spec.emits) {
    const li = document.createElement("li");
    li.className = "spec-line";
    li.textContent = line;
    emitsList.appendChild(li);
  }
  el.appendChild(emitsList);

  // Forbidden section
  const forbiddenH = document.createElement("h3");
  forbiddenH.textContent = "Forbidden";
  el.appendChild(forbiddenH);
  const forbiddenList = document.createElement("ul");
  for (const line of spec.forbidden) {
    const li = document.createElement("li");
    li.className = "spec-line";
    li.textContent = line;
    forbiddenList.appendChild(li);
  }
  el.appendChild(forbiddenList);

  // Escalates section
  const escalatesH = document.createElement("h3");
  escalatesH.textContent = "Escalates";
  el.appendChild(escalatesH);
  const escalatesList = document.createElement("ul");
  for (const line of spec.escalates) {
    const li = document.createElement("li");
    li.className = "spec-line";
    li.textContent = line;
    escalatesList.appendChild(li);
  }
  el.appendChild(escalatesList);
}
