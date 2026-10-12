import { describe, it, expect } from "vitest";
import { THEME_CHART, THEME_UI, getPaletteById } from "../chartPalettes";
import { ensureContrast, contrastRatio, meetsWcagAa } from "../wcagColor";

/** Themes tuned for on-chart contrast (see LOOM-071 / globals.css). */
const CHART_SURFACE_THEMES = ["dark", "contrast", "frost", "glass"] as const;

describe("chart palette contrast (LOOM-478)", () => {
  for (const theme of CHART_SURFACE_THEMES) {
    it(`${theme} series colors ≥3:1 on theme bg`, () => {
      const bg = THEME_UI[theme]!.bg;
      for (const c of THEME_CHART[theme]!) {
        expect(contrastRatio(c, bg)).toBeGreaterThanOrEqual(3);
      }
    });
  }

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
