import { describe, it, expect } from "vitest";
import { THEME_CHART, THEME_UI, getPaletteById, resolveChartColors } from "../chartPalettes";
import type { LookTheme } from "../lookSystem";
import { ensureContrast, contrastRatio, meetsWcagAa } from "../wcagColor";

/** Every theme's series must hold ≥3:1 on its plot bg (LOOM-071 / globals.css). */
const CHART_SURFACE_THEMES = Object.keys(THEME_UI) as LookTheme[];

describe("chart palette contrast (LOOM-478)", () => {
  for (const theme of CHART_SURFACE_THEMES) {
    it(`${theme} series colors ≥3:1 on theme bg`, () => {
      const bg = THEME_UI[theme]!.bg;
      for (const c of THEME_CHART[theme]!) {
        expect(contrastRatio(c, bg)).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${theme} colorblind series colors ≥3:1 on theme bg`, () => {
      const bg = THEME_UI[theme]!.bg;
      const resolved = resolveChartColors({ theme, colorblind: true });
      expect(resolved.paletteId).toBe("okabe");
      for (const c of resolved.colors) {
        expect(contrastRatio(c, bg)).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("okabe keeps its own stops where they already read", () => {
    // #BBBB00 is 1.55:1 on paper; it gets darkened, the darker stops stay put
    const paper = resolveChartColors({ theme: "paper", colorblind: true }).colors;
    expect(paper[0]).toBe("#4477AA");
    expect(paper[4]).not.toBe("#BBBB00");
    // An explicit palette choice is left alone
    expect(resolveChartColors({ theme: "paper", paletteId: "okabe" }).colors[4]).toBe("#BBBB00");
  });

  it("okabe and cividis stops pick AA ink against dark plot bg", () => {
    const bg = THEME_UI.dark!.bg;
    for (const id of ["okabe", "cividis"] as const) {
      for (const stop of getPaletteById(id)!.colors) {
        const ink = ensureContrast(bg, stop);
        expect(meetsWcagAa(ink, stop)).toBe(true);
      }
    }
  });
});
