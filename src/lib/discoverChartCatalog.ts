// Discovery's complete chart vocabulary, analytical families and recipe identity.
import type { ChartKind, ChartRecommendation } from "./recs/types";

export const DISCOVER_FAMILIES = {
  comparison: { label: "Compare & rank", prompt: "Who stands out?" },
  trend: { label: "Over time", prompt: "What is changing?" },
  distribution: { label: "Distributions", prompt: "What is typical?" },
  relationship: { label: "Relationships", prompt: "What moves together?" },
  composition: {
    label: "Parts of a whole",
    prompt: "Where is the concentration?",
  },
  connections: { label: "Connections", prompt: "How are groups connected?" },
  geography: { label: "Maps & globes", prompt: "Where is it happening?" },
  dimensional: {
    label: "Many dimensions",
    prompt: "What does another dimension reveal?",
  },
} as const;
export type DiscoverFamily = keyof typeof DISCOVER_FAMILIES;

// A new ChartKind must choose a family before it can ship.
export const DISCOVER_CHART_FAMILY: Record<ChartKind, DiscoverFamily> = {
  scatter: "relationship",
  bubble: "relationship",
  hexbin: "relationship",
  contour: "relationship",
  ecdf: "distribution",
  calendar: "trend",
  sparkGrid: "trend",
  rose: "composition",
  voronoi: "relationship",
  corrMatrix: "relationship",
  bar: "comparison",
  lollipop: "comparison",
  dumbbell: "comparison",
  pyramid: "comparison",
  slope: "comparison",
  waterfall: "comparison",
  radialBar: "comparison",
  isoBars: "comparison",
  line: "trend",
  area: "trend",
  bump: "trend",
  stream: "trend",
  horizon: "trend",
  spiral: "trend",
  loomWeave: "trend",
  histogram: "distribution",
  strip: "distribution",
  box: "distribution",
  violin: "distribution",
  ridgeline: "distribution",
  beeswarm: "distribution",
  bucketField: "distribution",
  pie: "composition",
  treemap: "composition",
  sunburst: "composition",
  forceBubble: "composition",
  waffle: "composition",
  isotype: "composition",
  pareto: "composition",
  funnel: "composition",
  mosaic: "composition",
  sankey: "connections",
  network: "connections",
  arcDiagram: "connections",
  chord: "connections",
  choropleth: "geography",
  geoPoints: "geography",
  geoBubbles: "geography",
  geoHex: "geography",
  globe: "geography",
  globeTrail: "geography",
  arcMap: "geography",
  radar: "dimensional",
  parallel: "dimensional",
  chernoff: "dimensional",
  glyphStar: "dimensional",
  flower: "dimensional",
  scatter3d: "dimensional",
  trailRibbon: "dimensional",
  quakeTerrain: "dimensional",
  firefly: "dimensional",
  dataCube: "dimensional",
  isoScatter: "dimensional",
  heatmap: "relationship",
};

export function discoverFamily(kind: string): DiscoverFamily {
  return DISCOVER_CHART_FAMILY[kind as ChartKind] ?? "comparison";
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v != null)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}

/** All encoding/settings fields participate, including future additions. */
export function discoverRecipeKey(chart: ChartRecommendation): string {
  const ignored = new Set([
    "id",
    "title",
    "subtitle",
    "score",
    "spec",
    "tooltipFields",
    "tooltipKeyField",
  ]);
  const recipe = Object.fromEntries(
    Object.entries(chart).filter(([key]) => !ignored.has(key)),
  );
  return JSON.stringify(canonical(recipe));
}

export function discoverRecipeId(chart: ChartRecommendation): string {
  let hash = 2166136261;
  for (const char of discoverRecipeKey(chart))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

/** The question preserves measure roles and aggregation; views keep their settings. */
export function discoverQuestionKey(
  source: string,
  chart: ChartRecommendation,
): string {
  return JSON.stringify([
    source,
    discoverFamily(chart.kind),
    chart.xField,
    chart.yField ?? "",
    chart.y2Field ?? "",
    chart.sizeField ?? "",
    chart.colorField ?? "",
    chart.rowField ?? "",
    chart.zField ?? "",
    chart.yField
      ? ["relationship", "distribution", "dimensional", "geography"].includes(
          discoverFamily(chart.kind),
        )
        ? "rows"
        : (chart.yAggregate ?? "sum")
      : "count",
    [
      "corrMatrix",
      "radar",
      "parallel",
      "chernoff",
      "glyphStar",
      "flower",
    ].includes(chart.kind)
      ? "multivariate"
      : "",
    chart.timeField ?? "",
    chart.trailId ?? "",
    chart.timeWindowField ?? "",
    chart.timeWindow ?? "all",
  ]);
}
