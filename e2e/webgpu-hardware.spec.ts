import { test, expect } from "@playwright/test";

test.skip(!process.env.LOOM_GPU_HARDWARE, "Opt in with npm run test:gpu:app on physical GPU hardware");

for (const kind of ["scatter", "scatter3d", "firefly", "dataCube"]) {
  test(`${kind} uses real GPU pixels with working chart interactions`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const audit = { adapters: [] as { vendor: string; fallback: boolean }[], errors: [] as string[], submits: 0 };
      Object.assign(window, { hardwareAudit: audit });
      const request = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = async function (descriptor) {
        audit.adapters.push({ vendor: this.info.vendor, fallback: this.info.isFallbackAdapter });
        const device = await request.call(this, descriptor);
        device.addEventListener("uncapturederror", event => audit.errors.push(event.error.message));
        return device;
      };
      const submit = GPUQueue.prototype.submit;
      GPUQueue.prototype.submit = function (commands) { audit.submits++; submit.call(this, commands); };
    });
    const chart = Buffer.from(JSON.stringify({ v: 1, src: kind === "dataCube" ? "mock://sales.csv" : "mock://scatter.csv", c: kind === "dataCube"
      ? { k: kind, x: "city", y: "product", z: "date", s: "revenue" }
      : { k: kind, x: "x", y: "y", z: "magnitude", s: "magnitude", c: "cluster" } })).toString("base64url");
    await page.goto(`/#chart=${chart}`);
    const gpu = page.getByLabel("WebGPU chart layer", { exact: true });
    await expect(gpu).toBeVisible({ timeout: 30_000 });
    const notes = page.getByRole("dialog").filter({ has: page.getByText("New in Loom", { exact: true }) });
    if (await notes.waitFor({ state: "visible", timeout: 2_000 }).then(() => true, () => false)) await notes.getByRole("button", { name: "Close", exact: true }).click();
    const stage = page.locator('[aria-roledescription="chart"]');
    if (kind === "scatter") {
      const navigation = page.getByRole("application", { name: /^Scatter chart\./ });
      await navigation.focus();
      await navigation.press("+");
      await expect(page.getByRole("button", { name: "Reset view", exact: true })).toBeVisible();
      await navigation.press("0");
      await expect(page.getByRole("button", { name: "Reset view", exact: true })).toHaveCount(0);
    } else if (kind === "dataCube") {
      await page.getByRole("button", { name: "Next slice", exact: true }).click();
      await page.getByTitle("Show the pivot table for this slice", { exact: true }).click();
      await expect(page.getByRole("table")).toBeVisible();
    } else {
      await stage.focus();
      await stage.press("ArrowRight");
      await stage.press("Enter");
      const clear = page.getByRole("button", { name: "Clear pinned readouts" });
      await expect(clear).toBeVisible();
      await clear.click();
      await expect(clear).toHaveCount(0);
    }
    await stage.screenshot({ path: testInfo.outputPath(`${kind}.png`) });
    const audit = await page.evaluate(() => (window as unknown as { hardwareAudit: { adapters: { vendor: string; fallback: boolean }[]; errors: string[]; submits: number } }).hardwareAudit);
    expect(audit.adapters.length).toBeGreaterThan(0);
    expect(audit.adapters.every(adapter => !adapter.fallback && !/swiftshader|software|llvmpipe/i.test(adapter.vendor))).toBe(true);
    expect(audit.submits).toBeGreaterThan(0);
    expect(audit.errors).toEqual([]);
    expect(errors).toEqual([]);
    await testInfo.attach("GPU adapter and submissions", { body: JSON.stringify(audit), contentType: "application/json" });
  });
}
