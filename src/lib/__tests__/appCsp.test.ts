import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_CSP_REPORT_ONLY } from "../appCsp";

describe("appCsp", () => {
  it("matches the report-only policy in public/_headers", () => {
    const headers = readFileSync(resolve(process.cwd(), "public/_headers"), "utf8");
    const matches = [...headers.matchAll(/Content-Security-Policy-Report-Only:\s*(.+)/g)].map(
      (m) => m[1]!.trim(),
    );
    expect(matches.length).toBeGreaterThan(0);
    for (const policy of matches) {
      expect(policy).toBe(APP_CSP_REPORT_ONLY);
    }
  });

  it("allows Cloudflare Insights and does not rely on meta delivery", () => {
    expect(APP_CSP_REPORT_ONLY).toContain("https://static.cloudflareinsights.com");
    const layout = readFileSync(resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).not.toMatch(/Content-Security-Policy-Report-Only/);
  });
});
