import { test, expect } from "@playwright/test";

test.skip(!process.env.LOOM_E2E, "Set LOOM_E2E=1 with a running static export");

const chart = Buffer.from(JSON.stringify({
  v: 1, src: "mock://sales.csv", c: { k: "bar", x: "city", y: "revenue", a: "sum" },
})).toString("base64url");

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 1100, height: 800 },
  { width: 834, height: 1112 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 667, height: 375 },
]) {
  test.describe(`chart editor at ${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 1100, deviceScaleFactor: 1 });
    test("keeps the chart, share action, and every editing section usable", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`/#chart=${chart}`);
      const stage = page.locator('[aria-roledescription="chart"]');
      await expect(stage).toBeVisible({ timeout: 30_000 });
      const notes = page.getByRole("dialog").filter({ has: page.getByText("New in Loom", { exact: true }) });
      if (await notes.waitFor({ state: "visible", timeout: 2_000 }).then(() => true, () => false)) {
        await notes.getByRole("button", { name: "Close", exact: true }).click();
      }
      const share = page.getByRole("button", { name: "Share chart", exact: true });
      await expect(share).toBeInViewport();
      const drawing = await stage.boundingBox();
      expect(drawing!.width).toBeGreaterThan(viewport.width >= 768 ? 300 : 250);
      expect(drawing!.height).toBeGreaterThan(120);

      const panel = page.locator("#loom-detail-panel");
      if (!(await panel.isVisible())) await page.getByRole("button", { name: /^Edit( chart)?$/ }).click();
      await expect(panel).toBeVisible();
      const sections = page.getByRole("tablist", { name: "Chart panel sections", exact: true });
      for (const name of ["Fields", "Visual", "Analyze", "Overlays"]) {
        const tab = sections.getByRole("tab", { name, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(tab).toBeInViewport();
        const dimensions = await panel.evaluate(el => {
          const content = el.querySelector("#panel-content")!;
          const tabs = el.querySelector('[aria-label="Chart panel sections"]')!;
          return {
            contentFits: content.scrollWidth <= content.clientWidth + 1,
            pageFits: document.documentElement.scrollWidth <= innerWidth,
            usableHeight: Math.min(content.getBoundingClientRect().bottom, innerHeight) - tabs.getBoundingClientRect().bottom,
          };
        });
        expect(dimensions.contentFits).toBe(true);
        expect(dimensions.pageFits).toBe(true);
        expect(dimensions.usableHeight).toBeGreaterThan(100);
      }
      // Roving tab focus works without leaving the editor or requiring a pointer.
      await sections.getByRole("tab", { name: "Overlays", exact: true }).press("Home");
      await expect(sections.getByRole("tab", { name: "Fields", exact: true })).toBeFocused();
      await page.locator("#loom-y-agg").selectOption("count");
      await expect(page.locator("#loom-y-agg")).toHaveValue("count");
      await page.getByRole("button", { name: "↶ Undo", exact: true }).click();
      await expect(page.locator("#loom-y-agg")).toHaveValue("sum");
      if (viewport.width < 768) {
        await panel.getByRole("button", { name: "Close", exact: true }).click();
        await expect(panel).toHaveCount(0);
        await expect(share).toBeInViewport();
      }
      const ideas = page.getByRole("button", { name: "Show ideas", exact: true });
      if (await ideas.isVisible()) {
        await ideas.click();
        await expect(page.getByRole("button", { name: "Back to chart", exact: true })).toBeVisible();
        const cards = page.locator(".loom-ideas-previews > *");
        await expect(cards.first()).toBeVisible();
        expect((await cards.first().boundingBox())!.width).toBeGreaterThanOrEqual(150);
        await page.getByRole("button", { name: "Back to chart", exact: true }).click();
        await expect(stage).toBeVisible();
      }
      expect(errors).toEqual([]);
    });
  });
}
