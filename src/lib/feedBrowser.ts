// =================================================================
// Loom — Feed browser model (Data & sources → Live feeds & packs)
// =================================================================
// Search + facet filters + sort over `sourceCatalog()`, split into a
// Saved group, the registry's sidebar groups, and curated packs. Pure so
// the sidebar and tests share one ordering.
// =================================================================

import { filterCatalog, type CatalogEntry, type CatalogFreshness } from "./sourceCatalog";
import { SOURCE_GROUP_LABELS, type SourceGeo, type SourceGroup, type SourceTopic } from "./sourceRegistry";
import { hasExplicitSourcePreferences, isHidden, isSourceSaved, sourceAffinity, type SourcePreferences } from "./sourcePreferences";

export type FeedSort = "foryou" | "freshest" | "az";
export type FeedWhere = "world" | "us" | "city";

export const FEED_WHERE_LABELS: Record<FeedWhere, string> = { world: "World", us: "US", city: "City" };
export const FEED_FRESHNESS_LABELS: Record<CatalogFreshness, string> = { live: "Live", daily: "Daily", historical: "Historical" };
/** "World" covers single-country feeds outside the US too (e.g. the UK grid). */
const WHERE_GEO: Record<FeedWhere, SourceGeo[]> = { world: ["world", "region"], us: ["us"], city: ["city"] };

export interface FeedBrowserState {
  query: string;
  topics: SourceTopic[];
  where: FeedWhere[];
  freshness: CatalogFreshness[];
  savedOnly: boolean;
  sort: FeedSort;
  showHidden: boolean;
}

export const DEFAULT_FEED_BROWSER_STATE: FeedBrowserState = {
  query: "",
  topics: [],
  where: [],
  freshness: [],
  savedOnly: false,
  sort: "foryou",
  showHidden: false,
};

export interface FeedGroup {
  id: SourceGroup | "saved" | "packs";
  label: string;
  entries: CatalogEntry[];
}

export interface FeedBrowseResult {
  groups: FeedGroup[];
  /** Entries hidden by preference that match the other filters. */
  hiddenCount: number;
  total: number;
}

/** Sort label: "Featured" (registry order) until the person has any preference. */
export function feedSortLabel(sort: FeedSort, prefs: SourcePreferences): string {
  if (sort === "freshest") return "Freshest";
  if (sort === "az") return "A–Z";
  return hasExplicitSourcePreferences(prefs) ? "For you" : "Featured";
}

const FRESH_RANK: Record<CatalogFreshness, number> = { live: 0, daily: 1, historical: 2 };

export function filtersActive(s: FeedBrowserState): boolean {
  return !!(s.query.trim() || s.topics.length || s.where.length || s.freshness.length || s.savedOnly);
}

export function browseFeeds(
  entries: CatalogEntry[],
  state: FeedBrowserState,
  prefs: SourcePreferences,
  opts: { lastUpdated?: (entry: CatalogEntry) => number | null | undefined; now?: number } = {},
): FeedBrowseResult {
  const now = opts.now ?? Date.now();
  const matched = filterCatalog(entries, {
    query: state.query,
    topics: state.topics,
    geo: state.where.flatMap((w) => WHERE_GEO[w]),
    freshness: state.freshness,
  });
  const relevance = new Map(matched.map((e, i) => [e.ref, i]));
  const registry = new Map(entries.map((e, i) => [e.ref, i]));
  let hiddenCount = 0;
  const kept = matched.filter((e) => {
    if (state.savedOnly && !isSourceSaved(e.ref, prefs)) return false;
    if (!state.showHidden && isHidden(e.ref, prefs)) {
      hiddenCount += 1;
      return false;
    }
    return true;
  });
  const searching = state.query.trim() !== "";
  const affinity = (e: CatalogEntry) => sourceAffinity(e.ref, prefs, now);
  const order = (a: CatalogEntry, b: CatalogEntry): number => {
    if (state.sort === "az") return a.label.localeCompare(b.label);
    if (state.sort === "freshest") {
      const ta = opts.lastUpdated?.(a) ?? 0;
      const tb = opts.lastUpdated?.(b) ?? 0;
      return tb - ta || FRESH_RANK[a.freshness] - FRESH_RANK[b.freshness] || registry.get(a.ref)! - registry.get(b.ref)!;
    }
    // For you: affinity, then search relevance, then registry order.
    return (
      affinity(b) - affinity(a) ||
      (searching ? relevance.get(a.ref)! - relevance.get(b.ref)! : 0) ||
      registry.get(a.ref)! - registry.get(b.ref)!
    );
  };
  const saved = kept.filter((e) => isSourceSaved(e.ref, prefs));
  const rest = kept.filter((e) => !isSourceSaved(e.ref, prefs));
  const groups: FeedGroup[] = [];
  if (saved.length) groups.push({ id: "saved", label: "Saved", entries: [...saved].sort(order) });
  for (const g of Object.keys(SOURCE_GROUP_LABELS) as SourceGroup[]) {
    const list = rest.filter((e) => e.type === "feed" && e.group === g);
    if (list.length) groups.push({ id: g, label: SOURCE_GROUP_LABELS[g], entries: list.sort(order) });
  }
  const packs = rest.filter((e) => e.type === "pack");
  if (packs.length) groups.push({ id: "packs", label: "Curated open packs", entries: packs.sort(order) });
  return { groups, hiddenCount, total: kept.length };
}
