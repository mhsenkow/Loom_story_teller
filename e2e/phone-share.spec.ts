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

test("share sheet opens from a sample chart", async ({ page }) => {
  // A portable sample link exercises cold-load chart hydration without live feeds
  // or the first-visit discovery overlay intercepting the start-page button.
  const chart = {
    v: 1,
    src: "mock://sales.csv",
    c: { k: "bar", x: "city", y: "revenue", a: "sum" },
  };
  const encoded = Buffer.from(JSON.stringify(chart)).toString("base64url");
  await page.goto(`/#chart=${encoded}`);
  const share = page.getByRole("button", { name: "Share chart", exact: true });
  await expect(share).toBeVisible({ timeout: 30_000 });
  await expect(share).not.toHaveAttribute("aria-disabled", "true");
  // Shared charts open their editor; dismiss its phone drawer to reach the toolbar.
  await page.getByRole("dialog", { name: "Detail panel", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
  await share.click();
  await expect(page.getByRole("dialog", { name: "Share", exact: true })).toBeVisible();
});
