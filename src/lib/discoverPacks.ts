// =================================================================
// Loom — Curated public tables in the opening Discover scan
// =================================================================
// Live feeds are already probed. These helpers decide which one-click
// CSVs can join that scan, how their samples stay cache-sized, and how
// a few of them lead the first screen.
// =================================================================

import { CURATED_OPEN_PACKS, type CuratedPack } from "./curatedPacks";
import type { QueryResult } from "./queryTypes";
import { SOURCE_TOPIC_LABELS } from "./sourceRegistry";

/** Above this, the opening scan leaves the file in the library. */
export const DISCOVER_PACK_MAX_BYTES = 1_800_000;

/** Chart variants kept per public table (feeds keep a wider set). */
export const DISCOVER_PACK_VARIANTS = 40;

/** Fewer variants on iPad and iPhone — the gallery only keeps a couple. */
export const DISCOVER_PACK_VARIANTS_MOBILE = 8;

/** How long one table may take before the scan moves on. */
export const DISCOVER_PACK_TIMEOUT_MS = 12_000;

/**
 * Measured far above the scan cap (about 12 MB). Still one tap in the library.
 * Other packs are skipped at fetch time when their body exceeds the cap.
 */
const DISCOVER_PACK_SKIP = new Set(["power-plants"]);

/** Small, chartable tables fetched in the first wave so the opening screen is not only live feeds. */
const DISCOVER_PACK_EARLY = [
  "gapminder",
  "owid-child-mortality",
  "owid-happiness",
  "keeling-curve",
  "eurostat-population",
  "airline-safety",
  "college-majors",
  "bad-drivers",
  "brent-oil",
  "us-cities",
  "candy-ranking",
  "nobel-laureates",
];

export type DiscoverPackKind = `pack:${string}`;

export function discoverPackKind(id: string): DiscoverPackKind {
  return `pack:${id}`;
}

export function isDiscoverPackKind(kind: string): kind is DiscoverPackKind {
  return kind.startsWith("pack:") && kind.length > "pack:".length;
}

export function discoverPackId(kind: string): string | null {
  return isDiscoverPackKind(kind) ? kind.slice("pack:".length) : null;
}

export function curatedPackById(id: string): CuratedPack | null {
  return CURATED_OPEN_PACKS.find((pack) => pack.id === id) ?? null;
}

/** Packs to probe. A kind list that names no packs probes none (live-only refresh). */
export function discoverPacksForScan(kinds?: readonly string[]): CuratedPack[] {
  const wanted = kinds?.filter(isDiscoverPackKind);
  if (kinds && !wanted?.length) return [];
  const packs = CURATED_OPEN_PACKS.filter((pack) => {
    if (DISCOVER_PACK_SKIP.has(pack.id)) return false;
    if (wanted?.length) return wanted.includes(discoverPackKind(pack.id));
    return true;
  });
  const early = new Map(DISCOVER_PACK_EARLY.map((id, index) => [id, index]));
  return packs.sort((a, b) => {
    const ai = early.get(a.id) ?? DISCOVER_PACK_EARLY.length;
    const bi = early.get(b.id) ?? DISCOVER_PACK_EARLY.length;
    return ai - bi || a.id.localeCompare(b.id);
  });
}

export function discoverPackEarlyCount(): number {
  return discoverPacksForScan().filter((pack) => DISCOVER_PACK_EARLY.includes(pack.id)).length;
}

/** Keep the time span when a table is longer than the discover cache allows. */
export function thinDiscoverRows(sample: QueryResult, maxRows: number): QueryResult {
  if (maxRows <= 0 || sample.rows.length <= maxRows) return sample;
  const step = Math.ceil(sample.rows.length / maxRows);
  const rows = [];
  for (let i = 0; i < sample.rows.length; i += step) rows.push(sample.rows[i]!);
  return {
    ...sample,
    rows,
    total_rows: Math.max(sample.total_rows ?? 0, sample.rows.length),
  };
}

export function discoverPackCategory(pack: CuratedPack): string {
  const topic = pack.topics[0];
  return topic ? SOURCE_TOPIC_LABELS[topic] : "Open data";
}

export function discoverPackPath(id: string): string {
  return `web://pack/${id}`;
}
