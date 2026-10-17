// Coordinated theme pairings are opt-in; manual type or chrome edits release them.
import { normalizeTheme, type LookTheme, type AppFont, type UiChrome } from "./lookSystem";
import type { AppSettings } from "./store/types";

export const THEME_PAIRINGS: Record<LookTheme, { font: AppFont; uiChrome: UiChrome; description: string }> = {
  light: { font: "source-sans", uiChrome: "noyes", description: "Clear sans, quiet borders, open space." },
  dark: { font: "inter", uiChrome: "noyes", description: "Balanced type and softly separated surfaces." },
  contrast: { font: "ibm-plex", uiChrome: "braun", description: "Direct letterforms and firm, readable edges." },
  paper: { font: "source-serif", uiChrome: "nyt", description: "Editorial serif, warm paper, fine rules." },
  glass: { font: "geist", uiChrome: "monocle", description: "Clean sans, translucent surfaces, soft light." },
  frost: { font: "source-sans", uiChrome: "monocle", description: "Open letterforms and cool luminous edges." },
  brutal: { font: "ibm-plex", uiChrome: "bauhaus", description: "Geometric structure, square corners, hard shadows." },
  loom: { font: "lora", uiChrome: "monocle", description: "Warm reading type and a subtle woven surface." },
  tank: { font: "ibm-plex-mono", uiChrome: "military", description: "Instrument-like numbers and precise rules." },
  nes: { font: "jetbrains-mono", uiChrome: "terminal", description: "Monospaced rhythm and crisp stepped edges." },
};

export function resolveThemePairing(previous: AppSettings, next: AppSettings): AppSettings {
  if (!next.themePairing) return next;
  if (previous.themePairing && previous.theme === next.theme &&
      (previous.font !== next.font || previous.uiChrome !== next.uiChrome)) {
    return { ...next, themePairing: false };
  }
  // System mode pairs neutral chrome/type with either OS palette.
  const pairing = THEME_PAIRINGS[normalizeTheme(next.theme)];
  return { ...next, font: pairing.font, uiChrome: pairing.uiChrome };
}
