// =================================================================
// Loom — Chart UX helpers (render issues, data health, honesty copy)
// =================================================================
// Used by ChartView overlays and DetailPanel stats. Keeps copy and
// validation logic out of large React components.
// =================================================================

import type { ChartKind, ChartRecommendation } from "./recommendations";
import type { ColumnInfo, QueryResult } from "./store";
import { ODD_NON_CARTESIAN, isOddChartKind } from "./oddCharts";
import { GPU_SCENE_NON_CARTESIAN, isGpuSceneKind } from "./gpuScenes";
import { GEO_MAP_NON_CARTESIAN, isGeoMapKind } from "./geoMaps";

export interface ChartRenderIssue {
  title: string;
  message: string;
  code: "no_data" | "no_rows" | "bad_x" | "bad_y" | "bad_z" | "bad_color" | "bad_size" | "bad_target" | "insufficient_numeric";
}

/** Kinds where Canvas renderers bail out without a Y column (no count fallback). */
const KINDS_REQUIRING_Y_FIELD = new Set<string>([
  "scatter", "bubble", "heatmap", "strip", "box", "violin",
  "dumbbell", "ridgeline", "hexbin", "parallel",
  "beeswarm", "voronoi", "isoScatter", "contour", "pyramid", "slope", "bump", "stream", "horizon",
  "dataCube",
]);

/** Structural reasons the current chart cannot draw on the loaded sample. */
export function getChartRenderIssue(
  chart: ChartRecommendation | null,
  sample: QueryResult | null,
): ChartRenderIssue | null {
  if (!chart) return null;
  if (!sample?.columns?.length) {
    return { title: "No data loaded", message: "Select a file or run a query so columns appear here.", code: "no_data" };
  }
  const cols = sample.columns;
  const rows = sample.rows;
  if (rows.length === 0) {
    if (chart.timeWindow && chart.timeWindow !== "all") {
      return {
        title: "No rows in this window",
        message: "Nothing in the sample falls inside the Time window. Pick a wider window, or All, in Encoding.",
        code: "no_rows",
      };
    }
    return { title: "No rows in sample", message: "This table returned zero rows. Try another file or adjust your query.", code: "no_rows" };
  }

  const xi = cols.indexOf(chart.xField);
  if (xi < 0) {
    return {
      title: "Column not found",
      message: `The X field “${chart.xField}” is missing from the current sample. Schema may have changed — pick another column.`,
      code: "bad_x",
    };
  }

  if (chart.yField) {
    const yi = cols.indexOf(chart.yField);
    if (yi < 0) {
      return {
        title: "Column not found",
        message: `The Y field “${chart.yField}” is missing from the current sample.`,
        code: "bad_y",
      };
    }
  } else if (KINDS_REQUIRING_Y_FIELD.has(chart.kind)) {
    return {
      title: "Y field required",
      message: `This chart type needs a Y column. Choose one in Encoding, or pick a working suggestion below.`,
      code: "bad_y",
    };
  }

  if (chart.colorField) {
    const ci = cols.indexOf(chart.colorField);
    if (ci < 0) {
      return {
        title: "Color column missing",
        message: `“${chart.colorField}” is not in the sample.`,
        code: "bad_color",
      };
    }
  }

  if (chart.sizeField) {
    const si = cols.indexOf(chart.sizeField);
    if (si < 0) {
      return {
        title: "Size column missing",
        message: `“${chart.sizeField}” is not in the sample.`,
        code: "bad_size",
      };
    }
  }

  if (chart.kind === "dataCube") {
    if (!chart.zField || cols.indexOf(chart.zField) < 0) {
      return {
        title: "Data cube needs a depth column",
        message: chart.zField
          ? `Depth field “${chart.zField}” is not in the sample.`
          : "Map a third column to Depth so rows × columns can stack into a cube.",
        code: "bad_z",
      };
    }
  }

  if (chart.kind === "dumbbell") {
    if (!chart.sizeField) {
      return {
        title: "Dumbbell needs an end value",
        message: "Map a second numeric column to Size (the other end of each stem).",
        code: "bad_size",
      };
    }
    if (chart.sizeField === chart.yField) {
      return {
        title: "Dumbbell ends must differ",
        message: "Y and Size must be two different numeric columns (start → end).",
        code: "bad_size",
      };
    }
  }

  if (chart.kind === "sankey" || chart.kind === "network" || chart.kind === "arcDiagram") {
    const target = chart.colorField ?? chart.yField;
    if (!target) {
      return {
        title: chart.kind === "network" ? "Network needs a target" : chart.kind === "arcDiagram" ? "Arc diagram needs a target" : "Sankey needs a target",
        message: "Map a second category to Color (link target).",
        code: "bad_target",
      };
    }
    const ti = cols.indexOf(target);
    if (ti < 0) {
      return { title: "Target column missing", message: `“${target}” is not in the sample.`, code: "bad_target" };
    }
  }

  if (chart.kind === "radar" || chart.kind === "parallel") {
    const skipIdx = chart.colorField ? cols.indexOf(chart.colorField) : -1;
    let numericCols = 0;
    for (let c = 0; c < cols.length; c++) {
      if (c === skipIdx) continue;
      const sampleN = rows.slice(0, 24).filter(r => r[c] !== null && r[c] !== "" && typeof r[c] !== "boolean" && !isNaN(Number(r[c]))).length;
      if (sampleN >= Math.min(12, rows.length * 0.4)) numericCols++;
    }
    const need = chart.kind === "parallel" ? 3 : 3;
    if (numericCols < need) {
      return {
        title: "Not enough numeric columns",
        message: chart.kind === "parallel"
          ? "Parallel coordinates need at least three numeric measures in the sample (excluding the color field)."
          : "Radar needs at least three numeric measures in the sample (excluding the color field).",
        code: "insufficient_numeric",
      };
    }
  }

  return null;
}

export interface DataQualityHints {
  nullHeavy: { name: string; pct: number }[];
  constantCols: string[];
  duplicateSummary: string | null;
}

function isNumericCol(c: ColumnInfo): boolean {
  const t = (c.data_type ?? "").toUpperCase();
  return ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT", "TINYINT", "SMALLINT"].some(n => t.includes(n));
}

/** From DuckDB stats + optional sample rows: null-heavy columns, constants, duplicate key hint. */
export function computeDataQualityHints(stats: ColumnInfo[], sample: QueryResult | null): DataQualityHints {
  const tableRows = sample?.total_rows ?? sample?.rows.length ?? 0;
  const nullHeavy: { name: string; pct: number }[] = [];
  const constantCols: string[] = [];

  for (const c of stats) {
    const n = Number(c.null_count) || 0;
    if (tableRows > 0 && n / tableRows >= 0.2) {
      nullHeavy.push({ name: c.name, pct: Math.round((n / tableRows) * 100) });
    }
    if ((c.distinct_count ?? 0) <= 1 && tableRows > 0) {
      constantCols.push(c.name);
    }
  }

  nullHeavy.sort((a, b) => b.pct - a.pct);

  let duplicateSummary: string | null = null;
  if (sample && sample.rows.length > 2 && stats.length > 0) {
    const candidates = stats.filter(c => !isNumericCol(c) && (c.distinct_count ?? 0) >= 2 && (c.distinct_count ?? 0) < sample.rows.length);
    let worst = { name: "", ratio: 1 };
    for (const c of candidates.slice(0, 8)) {
      const idx = sample.columns.indexOf(c.name);
      if (idx < 0) continue;
      const seen = new Set<string>();
      for (const r of sample.rows) {
        seen.add(String(r[idx] ?? ""));
      }
      const ratio = seen.size / sample.rows.length;
      if (ratio < worst.ratio) worst = { name: c.name, ratio };
    }
    if (worst.name && worst.ratio < 0.85) {
      const dupPct = Math.round((1 - worst.ratio) * 100);
      const uniq = seenSize(sample, worst.name);
      duplicateSummary = `“${worst.name}”: ~${dupPct}% repeated values in sample (${uniq} unique / ${sample.rows.length} rows)`;
    }
  }

  return { nullHeavy: nullHeavy.slice(0, 6), constantCols: constantCols.slice(0, 8), duplicateSummary };
}

function seenSize(sample: QueryResult, colName: string): number {
  const idx = sample.columns.indexOf(colName);
  if (idx < 0) return 0;
  const seen = new Set<string>();
  for (const r of sample.rows) seen.add(String(r[idx] ?? ""));
  return seen.size;
}

const AGG_LABEL: Record<string, string> = {
  sum: "Sum",
  mean: "Average",
  count: "Count",
  min: "Min",
  max: "Max",
};

/** Human-readable aggregation line for the active chart. */
export function formatChartAggregationSummary(chart: ChartRecommendation): string {
  const kindsWithAgg = new Set([
    "bar", "line", "area", "pie", "waterfall", "lollipop", "treemap", "sunburst", "forceBubble",
    "funnel", "dumbbell",
  ]);
  if (!kindsWithAgg.has(chart.kind)) {
    if (chart.kind === "histogram") return "Y axis: count per bin";
    if (chart.kind === "heatmap") return "Color: count per cell";
    if (chart.kind === "hexbin") return "Color: count per hex cell";
    if (chart.kind === "sankey") return chart.yField ? `Flow width: ${chart.yField}` : "Flow width: row count";
    if (chart.kind === "network" || chart.kind === "arcDiagram") {
      return chart.yField ? `Link weight: ${chart.yField}` : "Link weight: row count";
    }
    if (chart.kind === "radar") return "Axes: all numeric columns (mean per series)";
    if (chart.kind === "parallel") return "Axes: all numeric columns (one polyline per row)";
    if (chart.kind === "ridgeline") return "Density of X per Y group";
    return "Values from raw rows (no Y aggregate)";
  }
  const agg = !chart.yField ? "count" : (chart.yAggregate ?? (chart.kind === "line" || chart.kind === "radar" || chart.kind === "dumbbell" ? "mean" : "sum"));
  const label = AGG_LABEL[agg] ?? agg;
  if (chart.kind === "dumbbell" && chart.sizeField) {
    return `${label} of ${chart.yField} → ${chart.sizeField}`;
  }
  if (!chart.yField) return `${label} of rows per category`;
  return `${label} of ${chart.yField}`;
}

/** Charts that don’t use a cartesian X/Y plane (no axis chrome / grid). */
const NON_CARTESIAN = new Set<ChartKind>([
  "pie", "treemap", "sunburst", "forceBubble", "sankey", "network", "arcDiagram", "radar", "choropleth",
  "funnel", "parallel", "corrMatrix",
  ...(ODD_NON_CARTESIAN as unknown as ChartKind[]),
  ...(GPU_SCENE_NON_CARTESIAN as unknown as ChartKind[]),
  ...(GEO_MAP_NON_CARTESIAN as unknown as ChartKind[]),
]);

export interface ChartCapabilities {
  cartesian: boolean;
  /** Primary category / X slot — false when canvas ignores encoding X (e.g. radar uses all numerics). */
  xChannel: boolean;
  yChannel: boolean;
  /** Third spatial axis (scatter3d Z, data cube depth). */
  zChannel: boolean;
  colorChannel: boolean;
  sizeChannel: boolean;
  aggregate: boolean;
  /** Row facet / small multiples (bar, line, area, scatter). */
  facetRow: boolean;
  /** Top-N category limit control (bar and other aggregated category charts). */
  topN: boolean;
  /** Second Y measure overlay (line / area). */
  compareY: boolean;
  markPoints: boolean;
  opacityChannel: boolean;
  glowOutline: boolean;
  markMotif: boolean;
  barMarks: boolean;
  lineMarks: boolean;
  dataLabels: boolean;
  legend: boolean;
  referenceLines: boolean;
  scatterExtras: boolean;
  /** emphasisStyle is stored but not applied by the canvas renderer yet */
  emphasis: boolean;
}

/** Which Encoding / Visual controls actually affect this chart kind. */
export function chartCapabilities(kind: ChartKind): ChartCapabilities {
  const cartesian = !NON_CARTESIAN.has(kind);
  const scatterLike = kind === "scatter";
  const bubbleLike = kind === "bubble";
  const odd = isOddChartKind(kind);
  const gpu = isGpuSceneKind(kind);
  return {
    cartesian,
    // Radar/parallel draw every numeric column as an axis; X/Y slots are identity-only for parallel
    xChannel: kind !== "radar" && kind !== "parallel",
    yChannel: kind !== "histogram" && kind !== "radar" && kind !== "parallel",
    zChannel: kind === "scatter3d" || kind === "dataCube",
    // Show Color only when the canvas reads colorField / cIdx for this kind
    colorChannel: ![
      "histogram", "pie", "heatmap", "hexbin", "box", "waterfall", "choropleth", "ridgeline", "dataCube",
      "corrMatrix", "pareto",
      // Canvas ignores color for these
      "dumbbell", "funnel",
    ].includes(kind),
    sizeChannel: scatterLike || bubbleLike || kind === "dumbbell" || kind === "bucketField" || kind === "beeswarm" || kind === "isoScatter" || kind === "pyramid" || kind === "slope" || kind === "chernoff" || kind === "glyphStar" || kind === "flower" || gpu,
    aggregate: ["bar", "pareto", "line", "area", "pie", "waterfall", "lollipop", "treemap", "sunburst", "forceBubble", "funnel", "dumbbell", "waffle", "isotype", "radialBar", "isoBars", "chord", "mosaic"].includes(kind),
    facetRow: kind === "bar" || kind === "line" || kind === "area" || kind === "scatter" || kind === "bubble",
    // Only kinds whose canvas path actually ranks/caps categories (see ChartView / oddCharts).
    topN: kind === "bar" || kind === "pareto" || kind === "lollipop" || kind === "treemap" || kind === "sunburst" || kind === "forceBubble" || kind === "funnel" || kind === "waffle" || kind === "isotype" || kind === "radialBar" || kind === "isoBars",
    compareY: kind === "line" || kind === "area",
    // Visual mark shape / jitter / glow — only scatter's canvas mark pipeline
    markPoints: scatterLike,
    // Per-row opacity encoding (not global opacity slider)
    opacityChannel: scatterLike || kind === "strip",
    // Per-row glow / outline fields
    glowOutline: scatterLike,
    markMotif: cartesian && !["heatmap", "hexbin", "choropleth", "strip", "box", "violin", "ridgeline", "dumbbell", "contour", "voronoi", "corrMatrix"].includes(kind) && !gpu && !(GEO_MAP_NON_CARTESIAN as Set<string>).has(kind),
    // barCornerRadius is only read by renderFullBar / pareto
    barMarks: kind === "bar" || kind === "pareto",
    // lineStrokeStyle / smooth / width — line + area canvas only
    lineMarks: kind === "line" || kind === "area",
    // Kinds that check opts.showDataLabels (or odd env.opts.showDataLabels)
    dataLabels: ["bar", "pareto", "pie", "lollipop", "radialBar", "pyramid", "isoBars", "corrMatrix"].includes(kind),
    legend: (cartesian && !["histogram", "heatmap", "hexbin", "corrMatrix"].includes(kind)) || (isGeoMapKind(kind) && kind !== "geoHex") || kind === "radar" || kind === "pie" || kind === "sankey" || kind === "network" || kind === "arcDiagram" || kind === "parallel" || kind === "funnel" || kind === "pareto" || odd || gpu,
    // Reference lines need ropts.scales from the main cartesian path — not odd/GPU/geo
    referenceLines: cartesian && !odd && !["heatmap", "hexbin", "box", "violin", "ridgeline", "contour", "voronoi", "corrMatrix"].includes(kind) && !gpu,
    // Trail + marginals only in renderFullScatter
    scatterExtras: scatterLike,
    emphasis: false,
  };
}

/** Encoding slot labels for the active chart kind (not always “X/Y”). */
export function encodingChannelLabels(kind: ChartKind): { x: string; y: string; color: string; size: string } {
  const base = (x: string, y: string, color: string, size = "Size") => ({ x, y, color, size });
  switch (kind) {
    case "pie":
    case "forceBubble":
      return base("Slice", "Value", "Color");
    case "treemap":
    case "sunburst":
      return base("Leaf", "Value", "Nest");
    case "histogram":
      return base("Value", "Count", "Color");
    case "heatmap":
      return base("Column", "Row", "Heat");
    case "hexbin":
      return base("X", "Y", "Density");
    case "sankey":
    case "network":
    case "arcDiagram":
      return base("Source", "Weight", "Target");
    case "pareto":
      return base("Category", "Value", "Color");
    case "corrMatrix":
      return base("Measure A", "Measure B", "Color");
    case "radar":
      return base("Axis", "Value", "Series");
    case "parallel":
      return base("Axis A", "Axis B", "Series");
    case "box":
    case "violin":
      return base("Group", "Value", "Color");
    case "strip":
    case "ridgeline":
      return base("Value", "Group", "Color");
    case "waterfall":
    case "lollipop":
      return base("Category", "Value", "Color");
    case "dumbbell":
      return base("Category", "Start", "Color", "End");
    case "funnel":
      return base("Stage", "Value", "Color");
    case "choropleth":
      return base("Region", "Value", "Color");
    case "geoPoints":
      return base("Lon", "Lat", "Color", "Size");
    case "geoBubbles":
      return base("Lon", "Lat", "Color", "Size");
    case "geoHex":
      return base("Lon", "Lat", "Color");
    case "globe":
    case "globeTrail":
      return base("Lon", "Lat", "Color", "Size");
    case "arcMap":
      return base("Lon", "Lat", "Series");
    case "bucketField":
      return base("Bucket", "Value", "Color");
    case "beeswarm":
      return base("Group", "Value", "Color");
    case "chernoff":
    case "glyphStar":
    case "flower":
      return base("Identity", "Feature A", "Feature B", "Feature C");
    case "waffle":
    case "isotype":
    case "radialBar":
    case "isoBars":
      return base("Category", "Value", "Color");
    case "pyramid":
      return base("Category", "Left", "Color", "Right");
    case "slope":
      return base("Category", "Start", "Color", "End");
    case "bump":
    case "stream":
      return base("Order", "Value", "Series");
    case "horizon":
    case "spiral":
      return base("Time", "Value", "Color");
    case "chord":
    case "mosaic":
      return base("Source", "Weight", "Target");
    case "voronoi":
    case "isoScatter":
    case "contour":
      return base("X", "Y", "Color");
    case "scatter3d":
    case "firefly":
      return base("X", "Y", "Color", "Size");
    case "trailRibbon":
      return base("X", "Y", "Series", "Width");
    case "quakeTerrain":
      return base("Lon", "Lat", "Color", "Height");
    case "loomWeave":
      return base("Warp", "Value", "Color", "Weft");
    case "dataCube":
      return base("Rows", "Columns", "Color", "Value");
    default:
      return base("X", "Y", "Color");
  }
}
