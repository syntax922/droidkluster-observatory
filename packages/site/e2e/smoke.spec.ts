import { expect, test } from "@playwright/test";

// Site must be built with VITE_DATA_BASE=http://127.0.0.1:4174 (see CI step).

// The intro boot overlay opens in every fresh browser context (that's the
// feature) and sits at z-index 50 above the whole board, intercepting clicks
// meant for stations/dossier. These smoke tests care about the board, not
// the intro, so seed the "already seen" flag before the page's own scripts
// run — addInitScript executes before any page script, so intro.ts's
// initIntro() sees the flag on its very first read and skips the boot
// sequence entirely. The intro's own behavior (fresh boot, dismiss, reopen
// via toggle) is covered end-to-end in intro.spec.ts instead.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("observatory-intro-seen", "1");
  });
});

test("board renders stations, chain, honesty strip from fixture data", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#honesty")).toContainText("telemetry: live", { timeout: 10_000 });
  await expect(page.locator('[data-droid="hk-47"]')).toContainText("HK-47");
  await expect(page.locator("#chains .chain").first()).toBeVisible();
  await expect(page.locator("#chains .tl-node").first()).toBeVisible();
  await expect(page.locator('canvas[data-dmd="hk-47"]')).toBeVisible();
  await expect(page.locator("#journeys .lane-map").first()).toBeVisible();
});

test("clicking a station opens its dossier", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-droid="hk-47"]').click();
  await expect(page.locator("#dossier")).toContainText("Code reviewer");
});

test("dossier renders specification sections with abstraction disclaimer", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-droid="hk-47"]').click();
  await expect(page.locator("#dossier")).toContainText("abstracted from production");
});
