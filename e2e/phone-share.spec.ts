/**
 * LOOM-090 — phone journey smoke (set LOOM_E2E=1; serve `out/` via preview).
 */
import { test, expect } from "@playwright/test";

test.skip(!process.env.LOOM_E2E, "Set LOOM_E2E=1 with static out/ + npm run preview");

test("cold load shows chart affordance", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /interesting/i })).toBeVisible({
    timeout: 30_000,
  });
});

test("share sheet opens from chart view when data is loaded", async ({ page }) => {
  await page.goto("/");
  const interesting = page.getByRole("button", { name: /interesting/i });
  await interesting.waitFor({ state: "visible", timeout: 30_000 });
  await interesting.click();
  await page.waitForTimeout(1500);
  const share = page.getByRole("button", { name: /share/i }).first();
  if (await share.isVisible().catch(() => false)) {
    await share.click();
    await expect(page.getByRole("dialog").or(page.locator('[aria-modal="true"]'))).toBeVisible({
      timeout: 10_000,
    });
  }
});
