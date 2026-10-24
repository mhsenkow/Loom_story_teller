// =================================================================
// Loom — Chart type gallery grouping
// =================================================================
// The desktop chart-type gallery shows kinds by what they answer
// (compare, over time, spread, …) — the same analytic families
// Discover uses — rather than Classic / Creative. Pure; used by
// ChartKindGallery.
// =================================================================

import type { ChartKind } from "./recommendations";
import { DISCOVER_CHART_FAMILY, DISCOVER_FAMILIES, type DiscoverFamily } from "./discoverChartCatalog";
import type { ChartKindEntry } from "./chartKindSearch";

export const GALLERY_FAMILY_ORDER: DiscoverFamily[] = [
  "comparison",
  "trend",
  "distribution",
  "relationship",
  "composition",
  "connections",
  "dimensional",
  "geography",
];

export interface GalleryFamily {
  id: DiscoverFamily;
  label: string;
  prompt: string;
  entries: ChartKindEntry[];
}

export function galleryFamilyOf(kind: ChartKind): DiscoverFamily {
  return DISCOVER_CHART_FAMILY[kind] ?? "dimensional";
}

/** Group entries by family (in GALLERY_FAMILY_ORDER), keeping each family's input order; drop empty families. */
export function groupChartKindsByFamily(entries: ChartKindEntry[]): GalleryFamily[] {
  return GALLERY_FAMILY_ORDER.map((id) => ({
    id,
    label: DISCOVER_FAMILIES[id].label,
    prompt: DISCOVER_FAMILIES[id].prompt,
    entries: entries.filter((e) => galleryFamilyOf(e.value) === id),
  })).filter((f) => f.entries.length > 0);
}

/**
 * Next index in a responsive grid laid out family by family. Left/right walk the flat
 * order; up/down move one row within the family, or to the nearest column of the
 * neighbouring family's edge row.
 */
export function gridMove(
  families: { entries: unknown[] }[],
  flatIndex: number,
  cols: number,
  key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
): number {
  const total = families.reduce((n, f) => n + f.entries.length, 0);
  if (total === 0) return 0;
  if (key === "ArrowLeft") return Math.max(0, flatIndex - 1);
  if (key === "ArrowRight") return Math.min(total - 1, flatIndex + 1);
  // Locate family + position.
  let start = 0;
  let fi = 0;
  for (; fi < families.length; fi++) {
    const len = families[fi]!.entries.length;
    if (flatIndex < start + len) break;
    start += len;
  }
  const len = families[fi]?.entries.length ?? 0;
  const pos = flatIndex - start;
  const col = pos % cols;
  if (key === "ArrowDown") {
    if (pos + cols < len) return flatIndex + cols;
    if (fi + 1 >= families.length) return flatIndex;
    const nextLen = families[fi + 1]!.entries.length;
    return start + len + Math.min(col, nextLen - 1);
  }
  if (pos - cols >= 0) return flatIndex - cols;
  if (fi === 0) return flatIndex;
  const prevLen = families[fi - 1]!.entries.length;
  const prevStart = start - prevLen;
  const lastRowStart = Math.floor((prevLen - 1) / cols) * cols;
  return prevStart + Math.min(lastRowStart + col, prevLen - 1);
}
