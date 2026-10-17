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

/** Event-time resolver for export/capture paths that do not subscribe to React. */
export function resolveRuntimeTheme(preference?: string | null): LookTheme {
  if (preference !== "system") return normalizeTheme(preference);
  const dark = typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? true : window.matchMedia("(prefers-color-scheme: dark)").matches;
  return resolveEffectiveTheme(preference, dark);
}
