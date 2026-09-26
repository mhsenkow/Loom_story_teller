// =================================================================
// Loom — Chart UX helpers (render issues, data health, honesty copy)
// =================================================================
// Used by ChartView overlays and DetailPanel stats. Keeps copy and
// validation logic out of large React components.
// =================================================================

import type { ChartKind, ChartRecommendation } from "./recommendations";
import type { ColumnInfo, QueryResult } from "./store";

export interface ChartRenderIssue {
  title: string;
  message: string;
  code: "no_data" | "no_rows" | "bad_x" | "bad_y" | "bad_color" | "bad_size" | "bad_target" | "insufficient_numeric";
}

/** Kinds where Canvas renderers bail out without a Y column (no count fallback). */
const KINDS_REQUIRING_Y_FIELD = new Set<string>([
  "scatter", "bubble", "heatmap", "strip", "box", "violin",
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

  if (chart.kind === "sankey") {
    const target = chart.colorField ?? chart.yField;
    if (!target) {
      return { title: "Sankey needs a target", message: "Map a second category to Color (flow target).", code: "bad_target" };
    }
    const ti = cols.indexOf(target);
    if (ti < 0) {
      return { title: "Target column missing", message: `“${target}” is not in the sample.`, code: "bad_target" };
    }
  }

  if (chart.kind === "radar") {
    const skipIdx = chart.colorField ? cols.indexOf(chart.colorField) : -1;
    let numericCols = 0;
    for (let c = 0; c < cols.length; c++) {
      if (c === skipIdx) continue;
      const sampleN = rows.slice(0, 24).filter(r => r[c] !== null && r[c] !== "" && typeof r[c] !== "boolean" && !isNaN(Number(r[c]))).length;
      if (sampleN >= Math.min(12, rows.length * 0.4)) numericCols++;
    }
    if (numericCols < 3) {
      return {
        title: "Not enough numeric columns",
        message: "Radar needs at least three numeric measures in the sample (excluding the color field).",
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
  ]);
  if (!kindsWithAgg.has(chart.kind)) {
    if (chart.kind === "histogram") return "Y axis: count per bin";
    if (chart.kind === "heatmap") return "Color: count per cell";
    if (chart.kind === "sankey") return chart.yField ? `Flow width: ${chart.yField}` : "Flow width: row count";
    if (chart.kind === "radar") return "Axes: all numeric columns (mean per series)";
    return "Values from raw rows (no Y aggregate)";
  }
  const agg = !chart.yField ? "count" : (chart.yAggregate ?? (chart.kind === "line" || chart.kind === "radar" ? "mean" : "sum"));
  const label = AGG_LABEL[agg] ?? agg;
  if (!chart.yField) return `${label} of rows per category`;
  return `${label} of ${chart.yField}`;
}

/** Charts that don’t use a cartesian X/Y plane (no axis chrome / grid). */
const NON_CARTESIAN = new Set<ChartKind>([
  "pie", "treemap", "sunburst", "forceBubble", "sankey", "radar", "choropleth",
]);

export interface ChartCapabilities {
  cartesian: boolean;
  /** Primary category / X slot — false when canvas ignores encoding X (e.g. radar uses all numerics). */
  xChannel: boolean;
  yChannel: boolean;
  colorChannel: boolean;
  sizeChannel: boolean;
  aggregate: boolean;
  /** Facet rows — stored in Vega-ish specs but not drawn by canvas yet */
  facetRow: boolean;
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
  const pointMarks = kind === "scatter" || kind === "bubble";
  return {
    cartesian,
    // Radar draws every numeric column as an axis; X/Y slots are identity-only
    xChannel: kind !== "radar",
    yChannel: kind !== "histogram" && kind !== "radar",
    // Show Color only when the canvas reads colorField / cIdx for this kind
    colorChannel: ![
      "histogram", "pie", "heatmap", "box", "waterfall", "choropleth",
    ].includes(kind),
    sizeChannel: pointMarks,
    aggregate: ["bar", "line", "area", "pie", "waterfall", "lollipop", "treemap", "sunburst", "forceBubble"].includes(kind),
    facetRow: false,
    markPoints: pointMarks,
    opacityChannel: pointMarks || kind === "strip",
    glowOutline: pointMarks,
    markMotif: cartesian && !["heatmap", "choropleth", "strip", "box", "violin"].includes(kind),
    barMarks: kind === "bar" || kind === "histogram" || kind === "waterfall" || kind === "lollipop",
    lineMarks: kind === "line" || kind === "area",
    dataLabels: ["bar", "pie", "treemap", "forceBubble", "lollipop"].includes(kind),
    legend: (cartesian && !["histogram", "heatmap"].includes(kind)) || kind === "radar" || kind === "pie" || kind === "sankey",
    referenceLines: cartesian && !["heatmap", "box", "violin"].includes(kind),
    scatterExtras: pointMarks,
    emphasis: false,
  };
}

/** Encoding slot labels for the active chart kind (not always “X/Y”). */
export function encodingChannelLabels(kind: ChartKind): { x: string; y: string; color: string } {
  switch (kind) {
    case "pie":
    case "forceBubble":
      return { x: "Slice", y: "Value", color: "Color" };
    case "treemap":
    case "sunburst":
      return { x: "Leaf", y: "Value", color: "Nest" };
    case "histogram":
      return { x: "Value", y: "Count", color: "Color" };
    case "heatmap":
      return { x: "Column", y: "Row", color: "Heat" };
    case "sankey":
      return { x: "Source", y: "Weight", color: "Target" };
    case "radar":
      return { x: "Axis", y: "Value", color: "Series" };
    case "box":
    case "violin":
      return { x: "Group", y: "Value", color: "Color" };
    case "strip":
      return { x: "Value", y: "Group", color: "Color" };
    case "waterfall":
    case "lollipop":
      return { x: "Category", y: "Value", color: "Color" };
    case "choropleth":
      return { x: "Region", y: "Value", color: "Color" };
    default:
      return { x: "X", y: "Y", color: "Color" };
  }
}
