import { expect, test } from "@playwright/test";

test.skip(!process.env.LOOM_E2E, "Set LOOM_E2E=1 with a production static export");
test.use({ viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false });
for (const kind of ["bar", "line", "scatter", "scatter3d", "dataCube"]) {
  test(`${kind}: chart analysis applies, repaints, hides and removes`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const spatial = kind === "scatter" || kind === "scatter3d";
    const chart = Buffer.from(JSON.stringify({ v: 1, src: spatial ? "mock://scatter.csv" : "mock://sales.csv", c: spatial
      ? { k: kind, x: "x", y: "y", z: "magnitude" }
      : kind === "dataCube" ? { k: kind, x: "city", y: "product", z: "date", s: "revenue", a: "sum" }
      : { k: kind, x: kind === "line" ? "date" : "city", y: "revenue", a: "sum" } })).toString("base64url");
    await page.goto(`/#chart=${chart}`);
    const stage = page.locator('[aria-roledescription="chart"]');
    await expect(stage).toBeVisible({ timeout: 30_000 });
    const notes = page.getByRole("dialog").filter({ has: page.getByText("New in Loom", { exact: true }) });
    if (await notes.waitFor({ state: "visible", timeout: 2000 }).then(() => true, () => false)) await notes.getByRole("button", { name: "Close", exact: true }).click();
    const analyze = page.getByRole("tab", { name: "Analyze", exact: true });
    if (!(await analyze.isVisible())) await page.getByRole("button", { name: /^Edit( chart)?$/ }).click();
    await analyze.click();
    const card = page.getByRole("region", { name: "Chart anomaly detection" });
    await card.getByLabel("Chart anomaly threshold").fill("1");
    await card.getByRole("button", { name: "Find chart anomalies" }).click();
    await expect(card.getByRole("status")).toContainText(/unusual observations/);
    const count = Number((await card.getByRole("status").innerText()).split(" ")[0]);
    if (kind !== "bar") expect(count).toBeGreaterThan(0);
    if (count > 0) await expect(card.getByRole("table")).toBeVisible();
    else await expect(card.getByRole("table")).toHaveCount(0);
    if (process.env.LOOM_GPU_HARDWARE && (spatial || kind === "dataCube")) await expect(page.getByLabel("WebGPU chart layer", { exact: true })).toBeHidden();
    await testInfo.attach(`${kind}-analysis`, { body: await stage.screenshot({ path: testInfo.outputPath(`${kind}-analysis.png`) }), contentType: "image/png" });
    await card.getByRole("button", { name: "Hide detection" }).click();
    await expect(card.getByRole("status")).toHaveText("Detection hidden.");
    if (process.env.LOOM_GPU_HARDWARE && (spatial || kind === "dataCube")) await expect(page.getByLabel("WebGPU chart layer", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Show detection" }).click();
    if (count > 0) await expect(card.getByRole("table")).toBeVisible();
    await card.getByRole("button", { name: "Remove detection" }).click();
    await expect(card.getByRole("button", { name: "Find chart anomalies" })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
