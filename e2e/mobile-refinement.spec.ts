import { expect, test, type Page } from "@playwright/test";
test.skip(!process.env.LOOM_E2E, "Requires the static export preview");
async function openAnalysis(page: Page, kind = "line") {
  const encoded = Buffer.from(JSON.stringify({ v: 1, src: "mock://sales.csv", c: { k: kind, x: kind === "bar" ? "city" : "date", y: "revenue", a: "sum" } })).toString("base64url");
  await page.goto(`/#chart=${encoded}`);
  await expect(page.locator('[aria-roledescription="chart"]')).toBeVisible({ timeout: 30000 });
  const notes = page.getByRole("dialog").filter({ has: page.getByText("New in Loom", { exact: true }) });
  if (await notes.waitFor({ state: "visible", timeout: 2000 }).then(() => true, () => false)) await notes.getByRole("button", { name: "Close", exact: true }).click();
  const analyze = page.getByRole("tab", { name: "Analyze", exact: true });
  if (!await analyze.isVisible()) await page.getByRole("button", { name: /^Edit( chart)?$/ }).click();
  await analyze.click();
  await expect(page.getByRole("heading", { name: "Analyze this chart" })).toBeVisible();
}
for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 667, height: 375 }, { width: 834, height: 1112 }]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });
    test("analysis touch controls, partial typing, evidence scrolling and nested explanations", async ({ page }, testInfo) => {
      const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
      await openAnalysis(page);
      const panel = page.locator("#loom-detail-panel");
      const threshold = page.getByLabel("Chart anomaly threshold");
      await threshold.fill(""); await expect(threshold).toHaveValue("");
      await threshold.fill("1");
      await page.getByRole("button", { name: "Find chart anomalies" }).click();
      const table = page.getByRole("table", { name: /^Unusual observations/ });
      await expect(table).toBeVisible();
      const scroller = panel.locator(".loom-analysis-table-scroll").first();
      await scroller.scrollIntoViewIfNeeded();
      await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth; });
      expect(await scroller.evaluate(el => el.scrollWidth <= el.clientWidth || el.scrollLeft > 0)).toBe(true);
      expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const control of await panel.locator('.loom-analysis-panel input, .loom-analysis-panel select, .loom-analysis-panel button').all()) {
        expect((await control.boundingBox())!.height, await control.getAttribute("aria-label") ?? await control.innerText()).toBeGreaterThanOrEqual(44);
      }
      if (viewport.width < 768) expect(await threshold.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
      const intervals = page.getByLabel("Forecast preview intervals");
      await intervals.fill(""); await expect(intervals).toHaveValue("");
      await intervals.fill("51"); await intervals.press("Tab"); await expect(intervals).toHaveValue("50");
      await page.getByText("Line forecast overlays and events", { exact: true }).click();
      await page.getByRole("button", { name: "About forecast", exact: true }).click();
      const explanation = page.getByRole("dialog", { name: "Compare forecast methods" });
      await expect(explanation).toBeVisible();
      await explanation.getByRole("button", { name: "Close", exact: true }).focus();
      await page.keyboard.press("Shift+Tab");
      expect(await explanation.evaluate(el => el.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Escape");
      await expect(explanation).toHaveCount(0);
      await expect(panel).toBeVisible();
      await expect(page.getByRole("button", { name: "About forecast", exact: true })).toBeFocused();
      await page.getByRole("tab", { name: "Analyze", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("analysis-mobile.png") });
      expect(errors).toEqual([]);
    });
  });
}

test("quiet empty state honors OS and app reduced motion", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openAnalysis(page, "bar");
  await page.getByLabel("Chart anomaly threshold").fill("6");
  await page.getByRole("button", { name: "Find chart anomalies" }).click();
  const state = page.locator(".loom-empty-state").filter({ has: page.getByRole("heading", { name: "Nothing unusual at this threshold" }) });
  await expect(state).toBeVisible();
  expect(await state.locator("svg").getAttribute("aria-hidden")).toBe("true");
  expect(await state.locator(".loom-empty-frame").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => document.documentElement.classList.add("reduced-motion"));
  expect(await state.locator(".loom-empty-frame").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  await state.screenshot({ path: testInfo.outputPath("quiet-state.png") });
});

test("software-keyboard viewport keeps the phone sheet above the keyboard", async ({ page }) => {
  await openAnalysis(page);
  await page.getByLabel("Chart anomaly threshold").focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value: 360 });
    Object.defineProperty(window.visualViewport, "offsetTop", { configurable: true, value: 0 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  const panel = page.locator("#loom-detail-panel");
  await expect.poll(async () => (await panel.boundingBox())!.y + (await panel.boundingBox())!.height).toBeLessThanOrEqual(361);
  const close = panel.getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeInViewport();
  await close.click();
  await expect(panel).toHaveCount(0);
});
