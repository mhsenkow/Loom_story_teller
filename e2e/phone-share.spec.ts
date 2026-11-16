/**
 * LOOM-090 — phone journey smoke (set LOOM_E2E=1; serve `out/` via preview).
 */
import { test, expect, type Page } from "@playwright/test";

async function dismissReleaseNotes(page: Page) {
  const notes = page.getByRole("dialog").filter({ has: page.getByText("New in Loom", { exact: true }) });
  // Release notes can open after the lazy chart panel has hydrated.
  if (await notes.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) {
    await notes.getByRole("button", { name: "Close", exact: true }).click();
  }
}

async function dismissPhoneEditor(page: Page) {
  const editor = page.getByRole("dialog", { name: "Detail panel", exact: true });
  if (await editor.isVisible()) await editor.getByRole("button", { name: "Close", exact: true }).click();
}

test.skip(!process.env.LOOM_E2E, "Set LOOM_E2E=1 with static out/ + npm run preview");

test("cold load shows chart affordance", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^What’s interesting right now$/i })).toBeVisible({
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
  await dismissReleaseNotes(page);
  // Restore state can leave the editor open or closed; reach the toolbar in either case.
  await dismissPhoneEditor(page);
  await share.click();
  await expect(page.getByRole("dialog", { name: "Share", exact: true })).toBeVisible();
});

test("phone canvas title can be moved and restored with Undo", async ({ page }) => {
  const encoded = Buffer.from(JSON.stringify({ v: 1, src: "mock://sales.csv", c: { k: "bar", x: "city", y: "revenue", a: "sum" } })).toString("base64url");
  await page.goto(`/#chart=${encoded}`);
  await dismissReleaseNotes(page);
  await dismissPhoneEditor(page);
  await page.getByRole("button", { name: "Arrange chart layout", exact: true }).click();
  const title = page.getByRole("button", { name: "Move Title & subtitle", exact: true });
  await expect(title).toBeVisible();
  const before = (await title.boundingBox())!;
  await title.press("Shift+ArrowDown");
  await expect.poll(async () => (await title.boundingBox())!.y).toBeCloseTo(before.y + 10, 0);
  await title.press("Control+z");
  await expect.poll(async () => (await title.boundingBox())!.y).toBeCloseTo(before.y, 0);
  await page.getByRole("button", { name: "Done arranging", exact: true }).click();
  await expect(page.getByRole("button", { name: "Arrange chart layout", exact: true })).toBeVisible();
});
