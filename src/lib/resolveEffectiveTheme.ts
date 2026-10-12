// =================================================================
// resolveEffectiveTheme — "system" follows OS color scheme (LOOM-264)
// =================================================================

import { normalizeTheme, type LookTheme } from "./lookSystem";

export type ThemePreference = LookTheme | "system";

export function resolveEffectiveTheme(
  preference: ThemePreference | string | undefined | null,
  prefersDark: boolean,
): LookTheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return normalizeTheme(preference);
}
