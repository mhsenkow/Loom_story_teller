// =================================================================
// shellLayout — phone / tablet / desktop chrome policy
// =================================================================
// Breakpoints match chartViewport.detectDevice. Pure helpers so Vitest
// can cover enter/leave transitions without React.
// =================================================================

import { detectDevice, type DetectedDevice } from "./chartViewport";

export type ShellMode = "phone" | "tablet" | "desktop";

export type ShellDrawerState = {
  sidebarOpen: boolean;
  panelOpen: boolean;
};

export const SHELL_DESKTOP_PREFS_KEY = "loom-shell-desktop-prefs";
/** Chart suggestions rail open/closed (session). */
export const SUGGESTIONS_RAIL_PREFS_KEY = "loom-suggestions-rail";

/**
 * Touch-primary screens narrower than this get tablet chrome even when the
 * width alone says desktop — iPads in landscape are 1133–1366px wide, and the
 * three-panel desktop layout leaves the chart a sliver there.
 */
export const TOUCH_TABLET_MAX_WIDTH = 1400;

/** iPad / touch-first device (coarse primary pointer, or iPadOS desktop-class UA). */
export function isTouchPrimary(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(pointer: coarse)").matches) return true;
    // iPadOS reports a Mac UA; touch points give it away (Macs report 0).
    const nav = window.navigator;
    return (nav?.maxTouchPoints ?? 0) > 1 && /Macintosh|iPad/.test(nav.userAgent ?? "");
  } catch {
    return false;
  }
}

/**
 * Map viewport width → shell chrome mode. Same cutoffs as chartViewport,
 * except wide touch screens stay in tablet chrome (see TOUCH_TABLET_MAX_WIDTH).
 */
export function shellModeFromWidth(width: number, touchPrimary: boolean = isTouchPrimary()): ShellMode {
  const d: DetectedDevice = detectDevice(width);
  if (d === "mobile") return "phone";
  if (d === "tablet") return "tablet";
  if (touchPrimary && width < TOUCH_TABLET_MAX_WIDTH) return "tablet";
  return "desktop";
}

export function shellModeFromDevice(device: DetectedDevice): ShellMode {
  if (device === "mobile") return "phone";
  if (device === "tablet") return "tablet";
  return "desktop";
}

/** Defaults when entering a mode (cold load or mode change). */
export function shellDefaultsForMode(mode: ShellMode): ShellDrawerState {
  if (mode === "phone") return { sidebarOpen: false, panelOpen: false };
  if (mode === "tablet") return { sidebarOpen: false, panelOpen: true };
  return { sidebarOpen: true, panelOpen: true };
}

export function parseDesktopPrefs(raw: string | null): ShellDrawerState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ShellDrawerState>;
    if (typeof v.sidebarOpen !== "boolean" || typeof v.panelOpen !== "boolean") return null;
    return { sidebarOpen: v.sidebarOpen, panelOpen: v.panelOpen };
  } catch {
    return null;
  }
}

export function serializeDesktopPrefs(prefs: ShellDrawerState): string {
  return JSON.stringify({
    sidebarOpen: prefs.sidebarOpen,
    panelOpen: prefs.panelOpen,
  });
}

/**
 * Compute drawer state when the shell mode changes (or on cold load with prevMode null).
 * Desktop prefs are restored on enter-desktop; otherwise mode defaults apply.
 */
export function applyShellModeTransition(args: {
  prevMode: ShellMode | null;
  nextMode: ShellMode;
  /** Last known desktop drawer prefs (session). */
  desktopPrefs: ShellDrawerState | null;
  /** Current drawer state (preserve when rotating within phone/tablet). */
  current?: ShellDrawerState | null;
}): ShellDrawerState {
  const { prevMode, nextMode, desktopPrefs, current } = args;
  if (nextMode === "desktop") {
    return desktopPrefs ?? shellDefaultsForMode("desktop");
  }
  if (
    prevMode &&
    prevMode !== "desktop" &&
    (nextMode === "phone" || nextMode === "tablet") &&
    current
  ) {
    return current;
  }
  return shellDefaultsForMode(nextMode);
}

export function readDesktopPrefsFromSession(): ShellDrawerState | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    return parseDesktopPrefs(window.sessionStorage.getItem(SHELL_DESKTOP_PREFS_KEY));
  } catch {
    return null;
  }
}

export function writeDesktopPrefsToSession(prefs: ShellDrawerState): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(SHELL_DESKTOP_PREFS_KEY, serializeDesktopPrefs(prefs));
  } catch {
    /* private mode / quota — ignore */
  }
}

export function readSuggestionsRailFromSession(): boolean | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    const v = window.sessionStorage.getItem(SUGGESTIONS_RAIL_PREFS_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
    return null;
  } catch {
    return null;
  }
}

export function writeSuggestionsRailToSession(open: boolean): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(SUGGESTIONS_RAIL_PREFS_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Whether the data sidebar should use overlay (fixed) chrome. */
export function sidebarOverlays(mode: ShellMode): boolean {
  return mode === "phone" || mode === "tablet";
}

/** Whether the detail panel is a bottom sheet (phone only). */
export function panelIsSheet(mode: ShellMode): boolean {
  return mode === "phone";
}

/**
 * Dashboard CSS grid column classes for a layout template at a shell mode.
 * Fixed multi-column templates collapse on phone; tablet caps at 2 cols.
 */
export function dashboardGridClass(
  layout: string,
  mode: ShellMode,
): string {
  if (layout === "1x1") return "grid-cols-1";
  if (layout === "auto") {
    if (mode === "phone") return "grid-cols-1";
    if (mode === "tablet") return "grid-cols-1 sm:grid-cols-2";
    return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
  }
  if (layout === "1+2") return "grid-cols-1";
  if (mode === "phone") return "grid-cols-1";
  if (mode === "tablet") return "grid-cols-2";
  if (layout === "2x1" || layout === "2x2") return "grid-cols-2";
  if (layout === "3x2" || layout === "stream") return "grid-cols-3";
  return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
}

/** Inline grid style for 1+2 / stream — undefined when CSS classes alone are enough. */
export function dashboardGridStyle(
  layout: string,
  mode: ShellMode,
): { display: "grid"; gridTemplateColumns: string; gridAutoRows: string } | undefined {
  if (mode === "phone") return undefined;
  if (layout === "1+2") {
    if (mode === "tablet") return undefined; // single-column via gridClass
    return {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gridAutoRows: "minmax(140px, 1fr)",
    };
  }
  if (layout === "stream") {
    if (mode === "tablet") return undefined; // 2-col via gridClass; no hero span
    return {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gridAutoRows: "minmax(160px, 1fr)",
    };
  }
  return undefined;
}
