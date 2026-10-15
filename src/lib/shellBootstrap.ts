// =================================================================
// shellBootstrap — pre-React shell mode on <html> (LOOM-066)
// =================================================================
// Inline script in layout runs before the client bundle so drawer defaults
// and viewport hooks align with the real viewport on first paint.
// =================================================================

import {
  applyShellModeTransition,
  readDesktopPrefsFromSession,
  shellModeFromWidth,
  type ShellDrawerState,
  type ShellMode,
} from "./shellLayout";

/** Minified IIFE — keep in sync with shellModeFromWidth cutoffs + isTouchPrimary. */
export const SHELL_BOOTSTRAP_SCRIPT = `(function(){try{var w=window.innerWidth,n=navigator,t=(window.matchMedia&&matchMedia("(pointer: coarse)").matches)||(n.maxTouchPoints>1&&/Macintosh|iPad/.test(n.userAgent)),m=w<768?"phone":(w<1100||(t&&w<1400))?"tablet":"desktop";document.documentElement.dataset.shellMode=m;document.documentElement.dataset.shellWidth=String(w);document.documentElement.dataset.shellReady="1";}catch(e){}})();`;

export function readBootstrapShellWidth(): number | null {
  if (typeof document === "undefined") return null;
  const raw = document.documentElement.dataset.shellWidth;
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function readBootstrapShellMode(): ShellMode | null {
  if (typeof document === "undefined") return null;
  const m = document.documentElement.dataset.shellMode;
  if (m === "phone" || m === "tablet" || m === "desktop") return m;
  return null;
}

/** Drawer state for Zustand cold start (after bootstrap script). */
export function readInitialShellDrawers(): ShellDrawerState {
  if (typeof window === "undefined") {
    return { sidebarOpen: false, panelOpen: false };
  }
  const w = readBootstrapShellWidth() ?? window.innerWidth;
  const mode = shellModeFromWidth(w);
  return applyShellModeTransition({
    prevMode: null,
    nextMode: mode,
    desktopPrefs: readDesktopPrefsFromSession(),
  });
}
