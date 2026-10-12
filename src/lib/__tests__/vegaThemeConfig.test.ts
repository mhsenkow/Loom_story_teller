import { describe, expect, it } from "vitest";
import { vegaExportConfigForTheme } from "../vegaThemeConfig";

describe("vegaThemeConfig", () => {
  it("uses light-theme label colors for SVG export config", () => {
    const cfg = vegaExportConfigForTheme("light");
    const axis = cfg.axis as { labelColor?: string; titleColor?: string };
    expect(axis.labelColor).toBe("#5a5a5a");
    expect(axis.titleColor).toBe("#141414");
    expect(cfg.background).toBe("#f0efeb");
  });
});
