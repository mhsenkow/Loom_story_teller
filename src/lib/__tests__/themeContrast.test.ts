import { describe, it, expect } from "vitest";
import { THEME_UI } from "../chartPalettes";
import type { LookTheme } from "../lookSystem";
import { contrastRatio, meetsWcagAa } from "../wcagColor";
import { resolveThemeToken } from "./themeCss";

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

    it(`${theme}: badge ink meets AA on the error fill`, () => {
      const onError = resolveThemeToken(theme, "--on-error")!;
      expect(contrastRatio(onError, resolveThemeToken(theme, "--color-error")!)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme}: focus ring meets 3:1 on the chrome bg`, () => {
      // CSS --color-bg can differ from THEME_UI.bg (NES chrome is blue, its charts are light)
      const ring = resolveThemeToken(theme, "--focus-ring")!.split(/\s+/).pop()!;
      expect(contrastRatio(ring, resolveThemeToken(theme, "--color-bg")!)).toBeGreaterThanOrEqual(3);
    });
  }
});
