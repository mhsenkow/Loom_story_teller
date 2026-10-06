// =================================================================
// Loom — Chart type catalog grouping + search
// =================================================================
// Groups CHART_KIND_OPTIONS into Classic / Creative / 3D & GPU / Maps
// and ranks kinds against a free-text query (label, id, synonyms).
// Pure — used by ChartKindPicker.
// =================================================================

import { CHART_KIND_OPTIONS, type ChartKind } from "./recommendations";
import { ODD_CHART_KIND_OPTIONS } from "./oddCharts";
import { GPU_SCENE_KIND_OPTIONS } from "./gpuScenes";
import { GEO_MAP_KIND_OPTIONS } from "./geoMaps";

export type ChartKindGroup = "Classic" | "Creative" | "3D & GPU" | "Maps";

export const CHART_KIND_GROUP_ORDER: ChartKindGroup[] = ["Classic", "Creative", "3D & GPU", "Maps"];

export interface ChartKindEntry {
  value: ChartKind;
  label: string;
  group: ChartKindGroup;
}

/** Extra words people search for that aren't in the label. */
const SYNONYMS: Partial<Record<string, string>> = {
  scatter: "dot point xy correlation",
  bar: "column histogram compare",
  line: "trend time series",
  area: "filled trend",
  pie: "donut share part whole",
  heatmap: "matrix grid density",
  treemap: "nested hierarchy part whole",
  sunburst: "radial hierarchy",
  sankey: "flow alluvial",
  network: "graph force directed links nodes edges",
  arcDiagram: "arc links linear network",
  pareto: "80 20 cumulative ranked abc analysis",
  corrMatrix: "correlation pearson heatmap matrix r",
  radar: "spider web",
  parallel: "multivariate axes",
  box: "boxplot quartile distribution",
  violin: "distribution density",
  histogram: "distribution bins frequency",
  choropleth: "map region country state",
  scatter3d: "3d orbit point cloud xyz",
  dataCube: "3d cube voxel olap pivot rows columns depth",
  firefly: "particles glow",
  quakeTerrain: "3d heightfield surface",
  trailRibbon: "path trajectory",
  loomWeave: "textile threads",
};

function groupFor(kind: string): ChartKindGroup {
  if (GEO_MAP_KIND_OPTIONS.some((o) => o.value === kind) || kind === "choropleth") return "Maps";
  if (GPU_SCENE_KIND_OPTIONS.some((o) => o.value === kind)) return "3D & GPU";
  if (ODD_CHART_KIND_OPTIONS.some((o) => o.value === kind)) return "Creative";
  return "Classic";
}

/** Every chart kind once (first label wins), tagged with its group. */
export const CHART_KIND_CATALOG: ChartKindEntry[] = (() => {
  const seen = new Set<string>();
  const out: ChartKindEntry[] = [];
  for (const o of CHART_KIND_OPTIONS) {
    if (seen.has(o.value)) continue;
    seen.add(o.value);
    out.push({ value: o.value, label: o.label, group: groupFor(o.value) });
  }
  return out;
})();

/** "dataCube" → "data cube" so ids match word queries. */
function splitId(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[()·×\-_/]/g, " ").replace(/\s+/g, " ").trim();
}

/** 0 = no match; higher = better. Every query token must match somewhere. */
export function scoreChartKind(entry: ChartKindEntry, query: string): number {
  const q = normalize(query);
  if (!q) return 1;
  const label = normalize(entry.label);
  const id = splitId(entry.value);
  const raw = entry.value.toLowerCase();
  const hay = `${label} ${id} ${raw} ${normalize(SYNONYMS[entry.value] ?? "")} ${entry.group.toLowerCase()}`;
  const words = hay.split(" ");
  let score = 0;
  for (const tok of q.split(" ")) {
    if (!hay.includes(tok)) return 0;
    if (label.startsWith(tok) || id.startsWith(tok) || raw.startsWith(tok)) score += 4;
    else if (words.some((w) => w.startsWith(tok))) score += 2;
    else score += 1;
  }
  if (label === q || id === q || raw === q.replace(/ /g, "")) score += 10;
  return score;
}

/** Matching kinds, best first (catalog order breaks ties). Empty query → whole catalog. */
export function searchChartKinds(query: string, catalog: ChartKindEntry[] = CHART_KIND_CATALOG): ChartKindEntry[] {
  if (!normalize(query)) return catalog;
  return catalog
    .map((e, i) => ({ e, i, s: scoreChartKind(e, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.e);
}
