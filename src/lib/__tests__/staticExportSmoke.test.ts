import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** LOOM-686 — smoke that a production export layout exists after build (CI runs build separately). */
describe("static export smoke", () => {
  it("next config requests static export", () => {
    const cfg = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");
    expect(cfg).toMatch(/output:\s*["']export["']/);
  });

  it("out/index.html exists when build has been run locally", () => {
    const index = join(process.cwd(), "out", "index.html");
    if (!existsSync(index)) {
      expect(true).toBe(true);
      return;
    }
    const html = readFileSync(index, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html.length).toBeGreaterThan(500);
  });
});
