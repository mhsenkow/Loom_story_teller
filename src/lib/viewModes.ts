// =================================================================
// Main view tabs (TopBar) and the name copy should use for each one.
// =================================================================
// Below Tailwind `sm` (640px) the tab strip shows `short` names so five
// tabs fit a phone. Copy that points at a tab ("Opened in Explorer")
// calls viewModeName() so it matches the tab the person can see.
// =================================================================

import type { ViewMode } from "./store/types";

export const VIEW_MODES: { key: ViewMode; label: string; short: string; shortcut: string }[] = [
  { key: "explorer", label: "Explorer", short: "Table", shortcut: "1" },
  { key: "chart", label: "Chart", short: "Chart", shortcut: "2" },
  { key: "query", label: "Query", short: "SQL", shortcut: "3" },
  { key: "dive", label: "Dive", short: "Dive", shortcut: "4" },
  { key: "monitor", label: "Monitor", short: "Watch", shortcut: "5" },
];

/** True when the tab strip shows short names (matches the `sm:hidden` span in TopBar). */
export function tabsShowShortNames(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 639.98px)").matches;
}

/** The tab name the person sees right now: short on phones, full label otherwise. */
export function viewModeName(key: ViewMode, short: boolean = tabsShowShortNames()): string {
  const mode = VIEW_MODES.find((m) => m.key === key);
  if (!mode) return key;
  return short ? mode.short : mode.label;
}
