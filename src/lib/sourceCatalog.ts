// =================================================================
// Loom — Source catalog: every browsable feed + curated pack, flattened
// =================================================================
// One list the feed browser, preferences, and Collections read, built from
// `sourceRegistry.ts` (feeds) and `curatedPacks.ts` (packs). Catalog search
// results (Socrata / CKAN / TidyTuesday) stay live queries; they get a
// SourceRef from `sourceRef.ts` when loaded.
//
// Pure — no store or DOM imports.
// =================================================================

import { CURATED_OPEN_PACKS } from "./curatedPacks";
import {
  SOURCE_DEFS,
  SOURCE_TOPIC_LABELS,
  type JoinRole,
  type SourceGeo,
  type SourceGrain,
  type SourceGroup,
  type SourceTopic,
} from "./sourceRegistry";
import { feedRef, packRef, type SourceRef } from "./sourceRef";

/** How current the rows are: polled now, refreshed daily-ish, or fixed history. */
export type CatalogFreshness = "live" | "daily" | "historical";

export interface CatalogEntry {
  ref: SourceRef;
  type: "feed" | "pack";
  label: string;
  description: string;
  attribution: string;
  homepage: string;
  topics: SourceTopic[];
  geo: SourceGeo;
  grain: SourceGrain;
  freshness: CatalogFreshness;
  /** Sidebar group (feeds only). */
  group?: SourceGroup;
  /** Known column names (feeds only — packs learn theirs on load). */
  columns: string[];
  joinKeys: Partial<Record<JoinRole, string>>;
  /** Remote CSV (packs only). */
  url?: string;
}

const HOUR_MS = 3_600_000;

/** Feeds polled at least hourly are live; slower polls are daily; load-once feeds are history. */
export function freshnessForPoll(pollMs: number): CatalogFreshness {
  if (pollMs <= 0) return "historical";
  return pollMs <= HOUR_MS ? "live" : "daily";
}

export const WIKI_CATALOG_ENTRY: CatalogEntry = {
  ref: feedRef("wiki"),
  type: "feed",
  label: "Wikipedia Live",
  description: "Recent edits across Wikimedia projects as they happen — titles, bots, and language editions.",
  attribution: "Wikimedia recent changes · CC BY-SA",
  homepage: "https://www.wikimedia.org/",
  topics: ["culture"],
  geo: "world",
  grain: "event",
  freshness: "live",
  group: "web",
  columns: [],
  joinKeys: {},
};

export function buildSourceCatalog(): CatalogEntry[] {
  const feeds: CatalogEntry[] = SOURCE_DEFS.map((d) => ({
    ref: feedRef(d.kind),
    type: "feed",
    label: d.label,
    description: d.description,
    attribution: d.attribution,
    homepage: d.homepage,
    topics: d.topics,
    geo: d.geo,
    grain: d.grain,
    freshness: freshnessForPoll(d.pollMs),
    group: d.group,
    columns: d.columns,
    joinKeys: d.joinKeys ?? {},
  }));
  const packs: CatalogEntry[] = CURATED_OPEN_PACKS.map((p) => ({
    ref: packRef(p.id),
    type: "pack",
    label: p.title,
    description: p.blurb,
    attribution: p.source,
    homepage: p.url,
    topics: p.topics,
    geo: p.geo,
    grain: p.grain,
    freshness: "historical",
    columns: [],
    joinKeys: p.joinKeys ?? {},
    url: p.url,
  }));
  return [WIKI_CATALOG_ENTRY, ...feeds, ...packs];
}

let cached: CatalogEntry[] | null = null;

/** Memoized catalog (registry + packs are static). */
export function sourceCatalog(): CatalogEntry[] {
  return (cached ??= buildSourceCatalog());
}

export function catalogEntryFor(ref: SourceRef): CatalogEntry | null {
  return sourceCatalog().find((e) => e.ref === ref) ?? null;
}

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function haystack(e: CatalogEntry): string {
  return fold(
    [e.label, e.description, e.attribution, ...e.topics.map((t) => SOURCE_TOPIC_LABELS[t]), ...e.columns.map((c) => c.replace(/_/g, " "))].join(
      " ",
    ),
  );
}

export interface CatalogFilter {
  query?: string;
  topics?: SourceTopic[];
  geo?: SourceGeo[];
  freshness?: CatalogFreshness[];
  /** Keep entries that can be matched on this role (Collections). */
  joinRole?: JoinRole;
}

/**
 * Filter + text-match. Every whitespace-separated query term must appear;
 * label hits sort before description / column hits. Facets are OR within, AND across.
 */
export function filterCatalog(entries: CatalogEntry[], f: CatalogFilter): CatalogEntry[] {
  const terms = fold(f.query ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const scored: { e: CatalogEntry; score: number; i: number }[] = [];
  entries.forEach((e, i) => {
    if (f.topics?.length && !e.topics.some((t) => f.topics!.includes(t))) return;
    if (f.geo?.length && !f.geo.includes(e.geo)) return;
    if (f.freshness?.length && !f.freshness.includes(e.freshness)) return;
    if (f.joinRole && !e.joinKeys[f.joinRole]) return;
    if (!terms.length) {
      scored.push({ e, score: 0, i });
      return;
    }
    const hay = haystack(e);
    if (!terms.every((t) => hay.includes(t))) return;
    const label = fold(e.label);
    const score = terms.reduce((s, t) => s + (label.startsWith(t) ? 3 : label.includes(t) ? 2 : 0), 0);
    scored.push({ e, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.e);
}
