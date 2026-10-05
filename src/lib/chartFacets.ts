// =================================================================
// Loom — Row-facet helpers (small multiples)
// =================================================================
// Partition sample rows by a nominal column and lay out a grid of
// cells for canvas small multiples. Used by ChartView when
// ChartRecommendation.rowField is set.
// =================================================================

/** Cap distinct facet panels so labels stay readable. */
export const FACET_MAX_PANELS = 8;

export interface FacetPanel {
  key: string;
  rows: unknown[][];
}

export interface FacetCell {
  x: number;
  y: number;
  w: number;
  h: number;
  key: string;
}

/** Group rows by facet column; largest groups first, capped. */
export function partitionRowsByFacet(
  rows: unknown[][],
  facetIdx: number,
  maxPanels = FACET_MAX_PANELS,
): FacetPanel[] {
  if (facetIdx < 0 || rows.length === 0) return [];
  const map = new Map<string, unknown[][]>();
  for (const r of rows) {
    const k = String(r[facetIdx] ?? "");
    let bucket = map.get(k);
    if (!bucket) {
      bucket = [];
      map.set(k, bucket);
    }
    bucket.push(r);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, maxPanels)
    .map(([key, panelRows]) => ({ key, rows: panelRows }));
}

/** Grid of cells inside a plot rectangle (label strip reserved by caller via smaller h). */
export function layoutFacetCells(
  panels: FacetPanel[],
  left: number,
  top: number,
  width: number,
  height: number,
): FacetCell[] {
  const n = panels.length;
  if (n === 0 || width <= 0 || height <= 0) return [];
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * width) / Math.max(1, height))) || 1));
  const rows = Math.ceil(n / cols);
  const cw = width / cols;
  const ch = height / rows;
  const gap = Math.min(8, cw * 0.04, ch * 0.04);
  const cells: FacetCell[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    cells.push({
      x: left + c * cw + gap / 2,
      y: top + r * ch + gap / 2,
      w: Math.max(24, cw - gap),
      h: Math.max(24, ch - gap),
      key: panels[i]!.key,
    });
  }
  return cells;
}

/** Default Top-N for category charts when unset on the recommendation. */
export const DEFAULT_TOP_N = 20;

/** Clamp a Top-N control value. */
export function clampTopN(n: number | null | undefined, fallback = DEFAULT_TOP_N): number {
  if (n == null || !Number.isFinite(n)) return fallback;
  return Math.max(3, Math.min(50, Math.round(n)));
}

export const TOP_N_OPTIONS = [
  { value: 10, label: "Top 10" },
  { value: 15, label: "Top 15" },
  { value: 20, label: "Top 20" },
  { value: 30, label: "Top 30" },
  { value: 50, label: "Top 50" },
] as const;
