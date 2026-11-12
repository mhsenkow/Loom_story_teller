import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 568 }]) {
  test.describe(`3D camera at ${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 768, deviceScaleFactor: 1 });
    for (const kind of ["scatter3d", "dataCube", "globe", "globeTrail"]) {
      test(`${kind}: rotate, zoom, presets and reset stay accessible`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        const chart = Buffer.from(JSON.stringify({
          v: 1, src: kind === "dataCube" ? "mock://sales.csv" : "mock://scatter.csv",
          c: kind === "dataCube"
            ? { k: kind, x: "city", y: "product", z: "date", s: "revenue" }
            : { k: kind, x: "x", y: "y", z: "magnitude", s: "magnitude", c: "cluster" },
        })).toString("base64url");
        await page.goto(`/#chart=${chart}`);
        const camera = page.getByRole("group", { name: "3D camera", exact: true });
        await expect(camera).toBeVisible({ timeout: 30_000 });
        const notes = page.getByRole("dialog").filter({ has: page.getByText("New in Loom", { exact: true }) });
        if (await notes.waitFor({ state: "visible", timeout: 2_000 }).then(() => true, () => false)) {
          await notes.getByRole("button", { name: "Close", exact: true }).click();
        }
        const zoom = camera.getByLabel("Camera zoom", { exact: true });
        await camera.getByRole("button", { name: "Zoom in 3D", exact: true }).click();
        await expect(zoom).toHaveText("120%");
        await camera.getByRole("button", { name: "Reset 3D camera", exact: true }).click();
        await expect(zoom).toHaveText("100%");

        const stage = page.locator('[aria-roledescription="chart"]');
        await stage.focus();
        await stage.press("Shift+ArrowRight");
        const view = camera.getByRole("combobox", { name: "Camera view" });
        await expect(view).toHaveValue("custom");
        await stage.press("+");
        await expect(zoom).toHaveText("120%");
        await stage.press("0");
        await expect(zoom).toHaveText("100%");
        await expect(view).toHaveValue("perspective");
        for (const preset of ["front", "side", "above", "perspective"]) {
          await view.selectOption(preset);
          await expect(view).toHaveValue(preset);
        }
        for (const button of await camera.getByRole("button").all()) await expect(button).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const frame = await stage.boundingBox();
        expect(frame!.width).toBeGreaterThan(250);
        expect(frame!.height).toBeGreaterThan(120);
        expect(errors).toEqual([]);
      });
    }
  });
}
