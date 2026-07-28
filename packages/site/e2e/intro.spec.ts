import { expect, test } from "@playwright/test";

// Site must be built with VITE_DATA_BASE=http://127.0.0.1:4174 (see CI step).
//
// Deliberately does NOT seed "observatory-intro-seen" (contrast smoke.spec.ts's
// beforeEach) — this test needs the real fresh-context boot sequence, and
// exercises the fix for the #intro[hidden] specificity bug: without it, the
// overlay div stays full-viewport and display:flex even after dismissal,
// silently eating the station click below. Asserting the dossier opens after
// dismissal is what actually pins that fix at the e2e layer.
test("fresh boot overlay dismisses and releases the page", async ({ page }) => {
  await page.goto("/");

  const intro = page.locator("#intro");
  await expect(intro).toBeVisible();
  await expect(intro.locator(".intro-title")).toHaveText("DROIDKLUSTER FLEET OBSERVATORY");

  await page.getByRole("button", { name: "[ enter the observatory ]" }).click();
  await expect(intro).toBeHidden();

  // Proves the overlay actually released pointer events on the page
  // underneath it, not just that it looks gone.
  await page.locator('[data-droid="hk-47"]').click();
  await expect(page.locator("#dossier")).toContainText("Code reviewer");
});
