// =================================================================
// Loom — Chart UX helpers (render issues, data health, honesty copy)
// =================================================================
// Used by ChartView overlays and DetailPanel stats. Keeps copy and
// validation logic out of large React components.
// =================================================================

import type { ChartKind, ChartRecommendation } from "./recommendations";
import type { ColumnInfo, QueryResult } from "./queryTypes";
import { chartDefinition, chartFieldAllowed } from "./chartDefinitions";
import type { ChartCapabilities } from "./chartDefinitions";
export type { ChartCapabilities } from "./chartDefinitions";
import { chartNumber } from "./chartNumbers";

export interface ChartRenderIssue {
  title: string;
  message: string;
  code: "no_data" | "no_rows" | "bad_x" | "bad_y" | "bad_z" | "bad_color" | "bad_size" | "bad_target" | "insufficient_numeric";
}

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
        message: "Nothing in the sample falls inside the Time window. Pick a wider window, or All, in Fields.",
        code: "no_rows",
      };
    }
    return { title: "No rows in sample", message: "This table returned zero rows. Try another file or adjust your query.", code: "no_rows" };
  }

  const xi = cols.indexOf(chart.xField);
  const caps = chartCapabilities(chart.kind);
  if (xi < 0 && caps.xChannel) {
    return {
      title: "Column not found",
      message: `The X field “${chart.xField}” is missing from the current sample. Schema may have changed — pick another column.`,
      code: "bad_x",
    };
  }

  if (chart.yField && caps.yChannel) {
    const yi = cols.indexOf(chart.yField);
    if (yi < 0) {
      return {
        title: "Column not found",
        message: `The Y field “${chart.yField}” is missing from the current sample.`,
        code: "bad_y",
      };
    }
  } else if (chartDefinition(chart.kind).requirements.y) {
    return {
      title: "Y field required",
      message: `This chart type needs a Y column. Choose one in Fields, or pick a working suggestion below.`,
      code: "bad_y",
    };
  }

  if (chart.colorField && caps.colorChannel) {
    const ci = cols.indexOf(chart.colorField);
    if (ci < 0) {
      return {
        title: "Color column missing",
        message: `“${chart.colorField}” is not in the sample.`,
        code: "bad_color",
      };
    }
  }

  if (chart.sizeField && caps.sizeChannel) {
    const si = cols.indexOf(chart.sizeField);
    if (si < 0) {
      return {
        title: "Size column missing",
        message: `“${chart.sizeField}” is not in the sample.`,
        code: "bad_size",
      };
    }
  }

  if (chartDefinition(chart.kind).channels.z.required) {
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

  if (chartDefinition(chart.kind).requirements.distinctEnd) {
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

  if (chartDefinition(chart.kind).requirements.target) {
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

  if (chartDefinition(chart.kind).requirements.numericColumns > 0) {
    const skipIdx = caps.colorChannel && chart.colorField ? cols.indexOf(chart.colorField) : -1;
    let numericCols = 0;
    for (let c = 0; c < cols.length; c++) {
      if (c === skipIdx) continue;
      const values = rows.slice(0, 24).map(r => chartNumber(r[c])).filter(Number.isFinite);
      if (values.length >= Math.min(12, rows.length * 0.4) && (!chartDefinition(chart.kind).requirements.varyingNumericColumns || new Set(values).size > 1)) numericCols++;
    }
    const need = chartDefinition(chart.kind).requirements.numericColumns;
    if (numericCols < need) {
      return {
        title: "Not enough numeric columns",
        message: chart.kind === "corrMatrix" ? "Correlation needs at least two numeric measures that vary. Choose another chart for a single measure."
          : chart.kind === "parallel"
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
    "funnel", "dumbbell", "pyramid",
  ]);
  if (!kindsWithAgg.has(chart.kind)) {
    if (chart.kind === "histogram") return "Y axis: count per bin";
    if (chart.kind === "heatmap" || chart.kind === "hexbin") {
      const measure = chart.colorField && chart.yAggregate !== "count"
        ? `${AGG_LABEL[chart.yAggregate ?? "mean"]} of ${chart.colorField}`
        : "row count";
      return `Heat: ${measure} per ${chart.kind === "hexbin" ? "hex" : "cell"}`;
    }
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
  if (chart.kind === "pyramid" && chart.sizeField) {
    const scale =
      chart.pyramidScaleMode === "shared"
        ? "same scale"
        : chart.pyramidScaleMode === "independent"
          ? "separate scales"
          : "auto scale";
    return `${label} of ${chart.yField} ↔ ${chart.sizeField} · ${scale}`;
  }
  if (!chart.yField) return `${label} of rows per category`;
  return `${label} of ${chart.yField}`;
}

/** Charts that don’t use a cartesian X/Y plane (no axis chrome / grid). */
export type EncodingPanelHintLevel = "info" | "warn" | "error";

export interface EncodingPanelHint {
  id: string;
  level: EncodingPanelHintLevel;
  message: string;
}

/**
 * Inline Encoding-panel guidance for common foot-guns (dumbbell ends, split
 * mode, Top N vs cardinality, high-cardinality color, skewed Y).
 */
export function encodingPanelHints(
  chart: ChartRecommendation,
  stats: ColumnInfo[],
): EncodingPanelHint[] {
  const hints: EncodingPanelHint[] = [];
  const byName = new Map(stats.map((c) => [c.name, c]));

  if (chart.kind === "dumbbell") {
    if (!chart.sizeField) {
      hints.push({
        id: "dumbbell-need-end",
        level: "error",
        message: "Dumbbell needs an End column (Size) — a second numeric measure for the other stem tip.",
      });
    } else if (chart.sizeField === chart.yField) {
      hints.push({
        id: "dumbbell-same-ends",
        level: "error",
        message: "Start and End must be different columns — pick another numeric field for End.",
      });
    }
  }

  if (
    chart.colorField &&
    chart.rowField &&
    chart.colorField !== chart.rowField
  ) {
    hints.push({
      id: "split-fields-differ",
      level: "info",
      message: `Color (“${chart.colorField}”) and Facet (“${chart.rowField}”) differ — Split chips hide until they share one field (or clear one).`,
    });
  }

  if (chart.topN != null && chart.xField) {
    const xCol = byName.get(chart.xField);
    const distinct = xCol?.distinct_count ?? 0;
    if (distinct > 0 && chart.topN > distinct) {
      hints.push({
        id: "topn-above-cardinality",
        level: "warn",
        message: `Top ${chart.topN} is larger than “${chart.xField}” (${distinct} distinct) — every category already shows.`,
      });
    }
  }

  if (chart.colorField && chart.kind !== "heatmap" && chart.kind !== "hexbin") {
    const cCol = byName.get(chart.colorField);
    const distinct = cCol?.distinct_count ?? 0;
    if (distinct > 24 && !chart.groupInto) {
      hints.push({
        id: "color-high-cardinality",
        level: "warn",
        message: `“${chart.colorField}” has ${distinct} values — the legend will be hard to read. Group into fewer chunks, or use Facet or Top N.`,
      });
    }
  }

  if (chart.yField && (chart.kind === "scatter" || chart.kind === "line" || chart.kind === "area")) {
    const yCol = byName.get(chart.yField);
    const min = yCol?.min_value != null ? Number(yCol.min_value) : NaN;
    const max = yCol?.max_value != null ? Number(yCol.max_value) : NaN;
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max / min >= 10) {
      const scale = chart.yScale ?? "linear";
      if (scale === "linear") {
        hints.push({
          id: "y-skew-suggest-log",
          level: "info",
          message: `Y spans ~${Math.round(max / min)}× (min ${min} → max ${max}). Try Log or Symlog under Y scale.`,
        });
      }
    }
  }

  if (chart.kind === "pyramid" || chart.kind === "slope") {
    if (!chart.sizeField) {
      hints.push({
        id: "dual-measure-need-end",
        level: "warn",
        message: `${chart.kind === "pyramid" ? "Pyramid" : "Slope"} needs a Right/End measure — map a second numeric column to ${chart.kind === "pyramid" ? "Right" : "End"}.`,
      });
    } else if (chart.sizeField === chart.yField) {
      hints.push({
        id: "dual-measure-same",
        level: "error",
        message: "The two measures must be different columns.",
      });
    }
  }

  return hints;
}

export type EncodingDropSlot = "x" | "y" | "color" | "size" | "z";

/**
 * Whether dropping `colName` onto a channel is honest for this chart kind.
 * Soft rules only — createChartRec remains the hard gate.
 */
export const encodingDropAllowed = chartFieldAllowed;

/** Measure-axis scale transforms shown in Encoding. */
export type ChartYScaleOption = "linear" | "log" | "symlog";

export const CHART_Y_SCALE_OPTIONS: {
  value: ChartYScaleOption;
  label: string;
  title: string;
}[] = [
  { value: "linear", label: "Linear", title: "Even spacing — default" },
  { value: "log", label: "Log", title: "Logarithmic — compresses wide positive ranges" },
  { value: "symlog", label: "Symlog", title: "Symmetric log — soft log that allows zero / negatives" },
];

/** Measure grows this way — Auto keeps the existing portrait / label heuristic. */
export type ChartLayoutDirection = "auto" | "up" | "down" | "right" | "left";

export const CHART_LAYOUT_DIRECTIONS: {
  value: ChartLayoutDirection;
  label: string;
  title: string;
}[] = [
  { value: "auto", label: "Auto", title: "Pick vertical or horizontal from the stage" },
  { value: "up", label: "↑", title: "Vertical — zero at bottom, values grow up" },
  { value: "down", label: "↓", title: "Vertical — zero at top, values grow down (ranks, losses, deficits)" },
  { value: "right", label: "→", title: "Horizontal — zero at left, values grow right" },
  { value: "left", label: "←", title: "Horizontal — zero at right, values grow left" },
];

/** Iso / terrain Direction: rotate or flip the fake-3D floor (not bar grow). */
const ISO_FLOOR_DIRECTION_TITLES: Record<ChartLayoutDirection, string> = {
  auto: "Default floor facing — X along the right diamond edge, Y along the left",
  up: "Default floor facing (same as Auto for isometric charts)",
  down: "Rotate the floor 180° — swap near/far corners",
  right: "Rotate the floor 90° clockwise",
  left: "Rotate the floor 90° counter-clockwise",
};

const ISO_BAR_DIRECTION_TITLES: Record<ChartLayoutDirection, string> = {
  auto: "Bars grow up from the baseline; extrusion to the right",
  up: "Bars grow up from the baseline",
  down: "Bars grow down from the top (ranks, deficits)",
  right: "Bars grow up; extrude toward the right",
  left: "Bars grow up; extrude toward the left",
};

/** Per-kind tip under Encoding → Direction. */
export function encodingDirectionTip(kind: ChartKind): string {
  if (kind === "quakeTerrain" || kind === "isoScatter") {
    return "Rotates which floor edge is X vs Y so the isometric grid matches how you want to read it. Axes stay on the diamond.";
  }
  if (kind === "isoBars") {
    return "Flips grow-up vs grow-down and which way the fake-3D extrusion leans.";
  }
  return "Auto picks vertical vs horizontal from the stage size. Down/left put zero at the top/right — good for ranks and deficits.";
}

/** Button title for a Direction chip (bar family vs iso floor). */
export function encodingDirectionTitle(kind: ChartKind, dir: ChartLayoutDirection): string {
  if (kind === "quakeTerrain" || kind === "isoScatter") return ISO_FLOOR_DIRECTION_TITLES[dir];
  if (kind === "isoBars") return ISO_BAR_DIRECTION_TITLES[dir];
  return CHART_LAYOUT_DIRECTIONS.find((d) => d.value === dir)?.title ?? dir;
}

/** Resolve Encoding Direction into horizontal + reverse measure axis. */
export function resolveLayoutDirection(
  dir: ChartLayoutDirection | null | undefined,
  autoHorizontal: boolean,
): { horizontal: boolean; reverse: boolean } {
  switch (dir) {
    case "up":
      return { horizontal: false, reverse: false };
    case "down":
      return { horizontal: false, reverse: true };
    case "right":
      return { horizontal: true, reverse: false };
    case "left":
      return { horizontal: true, reverse: true };
    default:
      return { horizontal: autoHorizontal, reverse: false };
  }
}

export { measureSuggestsGrowDown } from "./chartFieldHeuristics";

/** Compatibility entry points; catalog is the only policy owner. */
export function defaultYAggregate(kind: ChartKind): "mean" | "sum" {
  return chartDefinition(kind).defaultAggregate;
}
export function chartCapabilities(kind: ChartKind): Readonly<ChartCapabilities> {
  return chartDefinition(kind).capabilities;
}

/** Encoding slot labels for the active chart kind (not always “X/Y”). */
export function encodingChannelLabels(kind: ChartKind): { x: string; y: string; color: string; size: string } {
  const { x, y, color, size } = chartDefinition(kind).channels;
  return { x: x.label, y: y.label, color: color.label, size: size.label };
}

/** Short Encoding tip for kinds with non-obvious channel roles. */
export function encodingKindBlurb(kind: ChartKind): string | null {
  switch (kind) {
    case "radar":
      return "Every numeric column becomes an axis. Set Series (Color) to compare groups.";
    case "parallel":
      return "Every numeric column becomes a parallel axis. Color groups the polylines.";
    case "corrMatrix":
      return "Pairwise correlations across numeric columns — no X/Y pickers.";
    case "histogram":
      return "Y is always a count of rows per bin of X.";
    case "pie":
      return "Slice is the category; Value is the measure (aggregated). Color usually matches Slice.";
    case "treemap":
    case "sunburst":
      return "Leaf is the category path; Value sizes the blocks. Nest (Color) builds hierarchy when set.";
    case "sankey":
    case "network":
    case "arcDiagram":
    case "chord":
    case "mosaic":
      return "Source → Target flow; Weight sizes the links. Pick two categorical columns plus a measure.";
    case "dumbbell":
      return "Start and End are two numeric measures on the same category — Size is the end measure. Delta shows the signed change or % on each row.";
    case "pyramid":
      return "Left and Right are opposing measures (e.g. male/female or cases/deaths). Scale picks same vs separate arm domains; Delta annotates Right−Left.";
    case "slope":
      return "Start and End are two timepoints or states for each category. Size is the end measure. Delta labels the rise or fall.";
    case "heatmap":
      return "Column × Row cells; Heat colors by a third measure (or count when unset).";
    case "hexbin":
      return "Bins dense X/Y into hexes; Color shows density (or an aggregate when set).";
    case "dataCube":
      return "Rows × Columns pivot; Value fills each cell (count when empty). Drag the cube to orbit.";
    case "forceBubble":
      return "Category packs into bubbles; Value sets radius after aggregation.";
    case "funnel":
      return "Stages ordered by Value — Top N keeps the largest stages.";
    case "pareto":
      return "Categories ranked by Value with a cumulative % line. Top N caps the bars.";
    case "bump":
      return "Order on X, ranked Value on Y, Series as Color. Bump mode toggles rank vs Δ rank.";
    case "stream":
      return "Order on X, stacked Value bands, Series as Color.";
    case "choropleth":
      return "Region names/codes join the basemap; Value fills each area.";
    case "geoPoints":
    case "geoBubbles":
    case "globe":
    case "globeTrail":
      return "Lon/Lat place marks; Color and Size encode extra measures.";
    case "chernoff":
    case "glyphStar":
    case "flower":
      return "Identity labels each glyph; Feature A/B/C map to face/star/petal channels.";
    case "quakeTerrain":
      return "X × Y lay the floor grid; Height (Z) raises each cell. Direction rotates the isometric view.";
    case "isoBars":
      return "Category bars extruded in fake 3D. Direction flips grow-up vs grow-down (and left/right).";
    case "isoScatter":
      return "X × Y on the isometric floor; Height lifts points. Direction rotates which floor edge is which.";
    case "calendar":
      return "Date lays out one cell per day (weeks across, weekdays down); Value colors it — count of rows when empty.";
    case "rose":
      return "Petal is the category; wedge area tracks Value. Stack (Color) splits each petal for sums and counts.";
    case "ecdf":
      return "Each line climbs from 0% to 100% as Value grows — read the median at 50%. Series (Color) compares groups.";
    case "sparkGrid":
      return "Order on X, Value on Y, one mini chart per Panel (Color). Each panel has its own scale; Top N caps the panels.";
    case "density":
      return "A smoothed histogram of Value — no bins to pick. Series (Color) overlays one curve per group; the rug marks raw values.";
    case "qq":
      return "Sorted Value against a normal bell curve. Points hugging the dashed line ≈ normal; an S-bend means heavy tails, a curve means skew.";
    case "connectedScatter":
      return "X × Y points joined in Order (a date or number) — or row order when Order is empty. Start and end are labeled.";
    case "stripes":
      return "One stripe per Order step, colored by how far Value sits above (warm) or below (cool) its own average.";
    case "wordCloud":
      return "Each Word sized by row count, or by Size by when set. Compare draws two clouds: one for each group when Compare by has a few groups, or a higher cloud and a lower cloud when it is a statistic such as market cap. Grid lays out up to eight groups. Top N caps how many words. Visual → Word cloud sets the word font, spiral, rows, or columns, and how large the words grow.";
    case "errorBars":
      return "Dot = group mean, whiskers = 95% confidence interval, faint dots = raw rows. Dashed line is the overall mean.";
    case "bucketField":
      return "Bucket splits the canvas into paddocks; Value/Size/Color decorate dots inside each.";
    default:
      return null;
  }
}

export { resolveIsoFloorOrient, orientIsoCell } from "./isoOrient";

/** Whether SVG export is meaningful for the current Vega spec (Canvas is authoritative). */
export function svgExportMode(vegaSpec: unknown, kind?: ChartKind): "off" | "approx" {
  if (kind && chartDefinition(kind).exports.svg.portable === "none") return "off";
  if (!vegaSpec || typeof vegaSpec !== "object") return "off";
  const spec = vegaSpec as Record<string, unknown>;
  if (Object.keys(spec).length === 0) return "off";
  const enc = spec.encoding;
  if (!enc || typeof enc !== "object" || Object.keys(enc as object).length === 0) return "off";
  return "approx";
}
