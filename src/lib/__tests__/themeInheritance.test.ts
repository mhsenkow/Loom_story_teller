import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { relativeLuminance } from "../chartInk";
import { vegaExportConfigForTheme } from "../vegaThemeConfig";
import { sanitizeChartVisualOverrides } from "../chartVisualSanitize";
import { THEMES } from "../lookSystem";
import { resolveChartColors, THEME_CHART, THEME_UI } from "../chartPalettes";
import { resolveThemeChartStyle } from "../themeChartStyle";
import { contrastRatio } from "../wcagColor";
import { resolveThemeToken } from "./themeCss";

const css = readFileSync(new URL("../../styles/globals.css", import.meta.url), "utf8");
describe("theme inheritance across renderers", () => {
  for (const theme of THEMES) {
    it(`${theme}: CSS and automatic Canvas series agree`, () => {
      const block = css.slice(css.indexOf(`html[data-theme="${theme}"]`)).split("}")[0]!;
      expect(block).toContain(`--chart-bg: ${THEME_UI[theme].bg};`);
      THEME_CHART[theme].forEach((color, i) => expect(block).toContain(`--chart-${i + 1}: ${color};`));
      expect(resolveChartColors({ theme, chartKind: "scatter" }).colors).toEqual(THEME_CHART[theme]);
    });
    it(`${theme}: magnitude colors have ordered lightness`, () => {
      const ramp = resolveChartColors({ theme, chartKind: "heatmap" });
      expect(ramp.kind).toBe("sequential");
      expect(ramp.colors).toHaveLength(7);
      const luminance = ramp.colors.map(relativeLuminance);
      luminance.slice(1).forEach((value, i) => expect(value).toBeGreaterThan(luminance[i]!));
      expect(resolveChartColors({ theme, chartKind: "heatmap", colorblind: true }).paletteId).toBe("cividis");
    });
    it(`${theme}: explicit choices and accessibility survive`, () => {
      expect(resolveThemeChartStyle(theme, { lineWidth: 4, barCornerRadius: 0 }).lineWidth).toBe(4);
      expect(resolveThemeChartStyle(theme, { barCornerRadius: 0 }).barCornerRadius).toBe(0);
      expect(resolveChartColors({ theme, colorblind: true }).paletteId).toBe("okabe");
      expect(resolveChartColors({ theme, paletteId: "categorical" }).paletteId).toBe("categorical");
      expect(resolveChartColors({ theme, chartKind: "corrMatrix" }).kind).toBe("diverging");
    });
  }
  it("SVG defaults honor explicit styles and accessible colors", () => {
    const config = vegaExportConfigForTheme("glass", { lineWidth: 4, barCornerRadius: 0, colorblindCharts: true });
    expect(config.line.strokeWidth).toBe(4);
    expect(config.bar.cornerRadius).toBe(0);
    expect(config.range.category).toEqual(resolveChartColors({ theme: "glass", colorblind: true }).colors);
  });
  it("restores inherited style when an override is cleared", () => {
    expect(resolveThemeChartStyle("nes", { lineWidth: undefined }).lineWidth).toBe(3);
    expect(resolveThemeChartStyle("glass").barCornerRadius).toBeGreaterThan(resolveThemeChartStyle("brutal").barCornerRadius!);
  });
});

describe("legacy html.dark / html.light classes do not leak tokens", () => {
  for (const theme of THEMES) {
    it(`${theme}: accent text, strong border and warning text are its own`, () => {
      const accentText = resolveThemeToken(theme, "--loom-accent-text");
      expect(accentText).toBe(theme === "dark" ? "#b4adff" : resolveThemeToken(theme, "--color-accent"));
      const borderStrong = resolveThemeToken(theme, "--loom-border-strong");
      if (theme !== "light") expect(borderStrong).not.toBe("#8a8a82");
      if (theme === "brutal" || theme === "nes") expect(borderStrong).toBe(resolveThemeToken(theme, "--color-border"));
      // Warning copy sits on the chart/content surface and must stay AA
      expect(contrastRatio(resolveThemeToken(theme, "--loom-warning-text")!, THEME_UI[theme].bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("only the dark theme brightens text-loom-accent", () => {
    expect(css).not.toContain("html.dark .text-loom-accent");
  });
});

it("preserves explicit edge grammar in saved chart styles and SVG", () => {
  const visual = sanitizeChartVisualOverrides({ lineCap: "butt", lineJoin: "bevel" });
  expect(visual).toMatchObject({ lineCap: "butt", lineJoin: "bevel" });
  expect(vegaExportConfigForTheme("glass", visual ?? {}).line).toMatchObject({ strokeCap: "butt", strokeJoin: "bevel" });
  expect(vegaExportConfigForTheme("nes").line).toMatchObject({ strokeCap: "square", strokeJoin: "miter" });
  expect(vegaExportConfigForTheme("glass").line).toMatchObject({ strokeCap: "round", strokeJoin: "round" });
});


it("inherits material and restores flat without losing other theme rules", () => {
  expect(resolveThemeChartStyle("glass").markMaterial).toBe("glaze");
  expect(resolveThemeChartStyle("frost").markMaterial).toBe("glaze");
  expect(resolveThemeChartStyle("paper").markMaterial).toBe("ink");
  expect(resolveThemeChartStyle("loom").markMaterial).toBe("satin");
  expect(resolveThemeChartStyle("tank").markMaterial).toBe("etched");
  expect(resolveThemeChartStyle("light").markMaterial).toBe("flat");
  expect(resolveThemeChartStyle("glass", { markMaterial: "flat" })).toMatchObject({ markMaterial: "flat", lineJoin: "round" });
  expect(sanitizeChartVisualOverrides({ markMaterial: "satin" })?.markMaterial).toBe("satin");
});

const THEME_RADIUS_MD: Record<(typeof THEMES)[number], string> = {
  light: "6px",
  dark: "8px",
  contrast: "0",
  paper: "3px",
  glass: "16px",
  frost: "10px",
  brutal: "0",
  loom: "8px",
  tank: "2px",
  nes: "0",
};

describe("theme geometry", () => {
  for (const theme of THEMES) {
    it(`${theme}: CSS radius matches the look`, () => {
      expect(resolveThemeToken(theme, "--radius-md")).toBe(THEME_RADIUS_MD[theme]);
    });
  }
  it("Glass is rounder than Paper, Paper rounder than Brutal", () => {
    expect(parseFloat(resolveThemeToken("glass", "--radius-md")!)).toBeGreaterThan(parseFloat(resolveThemeToken("paper", "--radius-md")!));
    expect(parseFloat(resolveThemeToken("paper", "--radius-md")!)).toBeGreaterThan(parseFloat(resolveThemeToken("brutal", "--radius-md")!));
  });
  it("Glass bars round more than Brutal", () => {
    expect(resolveThemeChartStyle("glass").barCornerRadius).toBe(8);
    expect(resolveThemeChartStyle("brutal").barCornerRadius).toBe(0);
  });
});
