import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  outputDir: "test-results/mobile-refinement",
  testMatch: ["mobile-refinement.spec.ts", "chart-quality.spec.ts"],
  projects: [
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "mobile-webkit", use: { ...devices["iPhone 14"], browserName: "webkit" } },
  ],
});
