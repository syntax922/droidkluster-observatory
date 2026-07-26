import { describe, expect, it } from "vitest";
import { renderDossier } from "./dossier.js";

describe("renderDossier", () => {
  it("renders identity, role, model, doctrine for a droid", () => {
    const el = document.createElement("aside");
    renderDossier(el, "hk-47");
    expect(el.textContent).toContain("HK-47");
    expect(el.textContent).toContain("Code reviewer");
    expect(el.textContent).toContain("CHANGES_REQUESTED");
    expect(el.querySelectorAll(".doctrine-line").length).toBeGreaterThan(1);
  });
});
