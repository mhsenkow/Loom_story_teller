import { describe, expect, it } from "vitest";
import { vegaExportConfigForTheme } from "../vegaThemeConfig";

describe("vegaThemeConfig", () => {
  it("uses light-theme label colors for SVG export config", () => {
    const cfg = vegaExportConfigForTheme("light");
    const axis = cfg.axis as { labelColor?: string; titleColor?: string };
    expect(axis.labelColor).toBe("#3d3d3d");
    expect(axis.titleColor).toBe("#141414");
    expect(cfg.background).toBe("#f0efeb");
  });
  it("carries Visual typography into SVG titles, axes, and legends", () => {
    const cfg = vegaExportConfigForTheme("light", { fontFamily: "Lora", axisFontSize: 16, titleFontWeight: 700, titleItalic: true });
    expect(cfg.axis.labelFont).toContain('"Lora"');
    expect(cfg.axis.labelFontSize).toBe(16);
    expect(cfg.legend.labelFontSize).toBe(16);
    expect(cfg.title.font).toContain('"Lora"');
    expect(cfg.title.fontSize).toBeGreaterThan(cfg.axis.labelFontSize);
    expect(cfg.title.fontStyle).toBe("italic");
    expect(cfg.title.fontWeight).toBe(700);
  });
});
