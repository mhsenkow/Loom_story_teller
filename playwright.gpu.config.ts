import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  outputDir: "test-results/gpu-app",
  testMatch: ["webgpu-hardware.spec.ts", "three-d.spec.ts", "chart-analysis.spec.ts"],
  projects: [{ name: "mac-hardware", use: { browserName: "chromium", channel: "chrome", headless: false, viewport: { width: 1280, height: 900 } } }],
});
