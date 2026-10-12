import { describe, it, expect } from "vitest";
import { THEME_UI } from "../chartPalettes";
import type { LookTheme } from "../lookSystem";
import { contrastRatio, meetsWcagAa } from "../wcagColor";

const THEMES = Object.keys(THEME_UI) as LookTheme[];

describe("theme token contrast (LOOM-481)", () => {
  for (const theme of THEMES) {
    const ui = THEME_UI[theme]!;
    it(`${theme}: text and label meet AA on bg`, () => {
      expect(meetsWcagAa(ui.text, ui.bg)).toBe(true);
      expect(meetsWcagAa(ui.label, ui.bg)).toBe(true);
    });

    it(`${theme}: muted and accent meet 3:1 on bg`, () => {
      expect(contrastRatio(ui.muted, ui.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(ui.accent, ui.bg)).toBeGreaterThanOrEqual(3);
    });

  }
});
