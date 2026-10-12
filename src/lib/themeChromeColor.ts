// =================================================================
// Loom — Browser chrome / status-bar color per theme (LOOM-662)
// =================================================================

import type { LookTheme } from "./lookSystem";

/** Matches `--color-bg` defaults in globals.css for each theme. */
const THEME_CHROME: Record<LookTheme, string> = {
  dark: "#0a0a0c",
  light: "#f2f2f0",
  paper: "#e6dfd2",
  glass: "#dce6f4",
  frost: "#060a14",
  brutal: "#ffffff",
  nes: "#1a1028",
  contrast: "#000000",
  loom: "#0c0f14",
  tank: "#0d1117",
};

export function themeChromeColor(theme: LookTheme | "system", prefersDark: boolean): string {
  if (theme === "system") return prefersDark ? THEME_CHROME.dark : THEME_CHROME.light;
  return THEME_CHROME[theme] ?? THEME_CHROME.dark;
}

const META_ID = "loom-theme-color";

/** Sync `<meta name="theme-color">` to the resolved app theme. */
export function applyThemeChromeColor(color: string): void {
  if (typeof document === "undefined") return;
  let el = document.querySelector<HTMLMetaElement>(`meta#${META_ID}`);
  if (!el) {
    el = document.createElement("meta");
    el.id = META_ID;
    el.name = "theme-color";
    document.head.appendChild(el);
  }
  el.content = color;
  el.removeAttribute("media");
}
