import { expect, test } from "@playwright/test";

// Site must be built with VITE_DATA_BASE=http://127.0.0.1:4174 (see CI step).
test("board renders stations, chain, honesty strip from fixture data", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#honesty")).toContainText("telemetry: live", { timeout: 10_000 });
  await expect(page.locator('[data-droid="hk-47"]')).toContainText("HK-47");
  await expect(page.locator("#chains .chain").first()).toBeVisible();
  await expect(page.locator("#chains .tl-node").first()).toBeVisible();
  await expect(page.locator('canvas[data-dmd="hk-47"]')).toBeVisible();
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
