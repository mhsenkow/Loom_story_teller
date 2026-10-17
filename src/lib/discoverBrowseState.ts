// =================================================================
// Discovery browse position — small, per-tab preferences, never data rows.
// =================================================================

import type { DiscoverSettingFilter } from "./discoverPresentation";

export type DiscoverLayout = "flow" | "tiles" | "masonry" | "list";
export type DiscoverSort = "score" | "category" | "chart" | "source" | "name";
export type DiscoverSize = "compact" | "comfort" | "broadsheet";
export interface DiscoverBrowseState {
  search: string;
  settingFilter: DiscoverSettingFilter;
  categoryFilter: string;
  chartFilter: string;
  sourceFilter: string;
  sortMode: DiscoverSort;
  layout: DiscoverLayout;
  size: DiscoverSize;
  filtersOpen: boolean;
  shownCount: number;
  scrollTop: number;
}
const KEY = "loom-discover-browse-v1";
export const DEFAULT_DISCOVER_BROWSE: DiscoverBrowseState = {
  search: "",
  settingFilter: "all",
  categoryFilter: "all",
  chartFilter: "all",
  sourceFilter: "all",
  sortMode: "score",
  layout: "flow",
  size: "comfort",
  filtersOpen: false,
  shownCount: 24,
  scrollTop: 0,
};

export function readDiscoverBrowseState(): DiscoverBrowseState {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (!raw || raw.version !== 1) return { ...DEFAULT_DISCOVER_BROWSE };
    const state = { ...DEFAULT_DISCOVER_BROWSE };
    for (const key of [
      "search",
      "categoryFilter",
      "chartFilter",
      "sourceFilter",
    ] as const)
      if (typeof raw[key] === "string") state[key] = raw[key].slice(0, 300);
    if (["flow", "tiles", "masonry", "list"].includes(raw.layout))
      state.layout = raw.layout;
    if (["compact", "comfort", "broadsheet"].includes(raw.size))
      state.size = raw.size;
    if (["score", "category", "chart", "source", "name"].includes(raw.sortMode))
      state.sortMode = raw.sortMode;
    if (
      ["all", "compare", "facet", "window", "stack", "transform", "symbols"].includes(
        raw.settingFilter,
      )
    )
      state.settingFilter = raw.settingFilter;
    state.filtersOpen = raw.filtersOpen === true;
    if (Number.isFinite(raw.shownCount))
      state.shownCount = Math.min(
        10_000,
        Math.max(24, Math.floor(raw.shownCount)),
      );
    if (Number.isFinite(raw.scrollTop))
      state.scrollTop = Math.min(10_000_000, Math.max(0, raw.scrollTop));
    return state;
  } catch {
    return { ...DEFAULT_DISCOVER_BROWSE };
  }
}

export function saveDiscoverBrowseState(state: DiscoverBrowseState): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...state, version: 1 }));
  } catch {
    /* Storage restrictions still allow in-session return. */
  }
}
