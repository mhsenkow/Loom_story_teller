/** Bundled font loading, canvas repaint, and keyboard/touch typography editing. */
import { test, expect, type Page } from "@playwright/test";

test.skip(
  !process.env.LOOM_E2E,
  "Set LOOM_E2E=1 with a production static export",
);

async function openCloud(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as {
      loomFontPaints: Record<string, string>;
    };
    state.loomFontPaints = {};
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      x,
      y,
      maxWidth,
    ) {
      if (["London", "Tokyo", "city sized by revenue"].includes(text))
        state.loomFontPaints[text] = this.font;
      if (maxWidth == null) original.call(this, text, x, y);
      else original.call(this, text, x, y, maxWidth);
    };
  });
  const encoded = Buffer.from(
    JSON.stringify({
      v: 1,
      src: "mock://sales.csv",
      c: { k: "wordCloud", x: "city", y: "revenue", a: "sum" },
    }),
  ).toString("base64url");
  await page.goto(`/#chart=${encoded}`);
  await expect(page.locator("canvas:visible").first()).toBeVisible({ timeout: 30_000 });
  const notes = page
    .getByRole("dialog")
    .filter({ has: page.getByText("New in Loom", { exact: true }) });
  if (
    await notes.waitFor({ state: "visible", timeout: 3_000 }).then(
      () => true,
      () => false,
    )
  )
    await notes.getByRole("button", { name: "Close", exact: true }).click();
  const visual = page.getByRole("tab", { name: "Visual", exact: true });
  if (!(await visual.isVisible())) await page.getByRole("button", { name: /^Edit( chart)?$/ }).click();
  await visual.click();
}

test.describe("desktop typography", () => {
  test.use({
    viewport: { width: 1440, height: 1100 },
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
  });

  test("named fonts load distinct glyphs without a font CDN and repaint the cloud independently", async ({
    page,
  }) => {
    const externalFonts: string[] = [];
    page.on("request", (request) => {
      if (/fonts\.(googleapis|gstatic)\.com/.test(request.url()))
        externalFonts.push(request.url());
    });
    await openCloud(page);
    await page
      .getByRole("button", { name: "Collapse all", exact: true })
      .click();
    await page.getByRole("button", { name: "Typography", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Font family", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Search font family" })
      .fill("Source Serif");
    await page
      .getByRole("combobox", { name: "Search font family" })
      .press("Enter");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { loomFontPaints: Record<string, string> })
              .loomFontPaints["city sized by revenue"],
        ),
      )
      .toContain("Source Serif 4");
    await page.getByRole("button", { name: "Word cloud", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Word font", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Search word font" })
      .fill("fraunces");
    await page
      .getByRole("combobox", { name: "Search word font" })
      .press("Enter");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { loomFontPaints: Record<string, string> })
              .loomFontPaints.London,
        ),
      )
      .toContain("Fraunces");
    const widths = await page.evaluate(async () => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      return Promise.all(
        [
          "Inter",
          "Source Sans 3",
          "Geist",
          "Lora",
          "Source Serif 4",
          "Fraunces",
        ].map(async (family) => {
          const loaded = await document.fonts.load(`400 24px "${family}"`);
          ctx.font = `400 24px "${family}"`;
          return {
            loaded: loaded.length,
            width: ctx.measureText("Distinctive stories 012345").width,
          };
        }),
      );
    });
    expect(widths.every((face) => face.loaded > 0)).toBe(true);
    expect(new Set(widths.map((face) => face.width)).size).toBe(6);
    expect(externalFonts).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});

test.describe("phone typography", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });

  test("font search, size and weight controls fit the live editor", async ({
    page,
  }) => {
    await openCloud(page);
    await page
      .getByRole("button", { name: "Collapse all", exact: true })
      .click();
    await page.getByRole("button", { name: "Typography", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Font family", exact: true })
      .click();
    const search = page.getByRole("combobox", { name: "Search font family" });
    await search.fill("manrope");
    await search.press("Enter");
    await expect(
      page.getByRole("combobox", { name: "Font family", exact: true }),
    ).toContainText("Manrope");
    await page
      .getByRole("combobox", { name: "Title weight", exact: true })
      .selectOption("700");
    await page
      .getByRole("combobox", { name: "Chart text size", exact: true })
      .selectOption("16");
    const sample = page.getByRole("group", { name: "Chart typography sample" });
    await expect(sample).toHaveCSS("font-size", "16px");
    for (const label of ["Font family", "Title weight", "Chart text size"]) {
      const box = (await page
        .getByRole("combobox", { name: label, exact: true })
        .boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.height).toBeGreaterThanOrEqual(36);
    }
    await page
      .getByRole("button", { name: "Reset typography", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Font family", exact: true }),
    ).toContainText("App typeface");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});
