import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.LOOM_E2E_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "iphone", use: { ...devices["iPhone 14"] } }],
  webServer: process.env.LOOM_E2E
    ? {
        command: "npm run preview",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
