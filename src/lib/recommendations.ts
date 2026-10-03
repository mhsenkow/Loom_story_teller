// =================================================================
// Loom — Chart Recommendation Engine
// =================================================================
// Analyzes column metadata and sample data to produce a ranked list
// of chart suggestions. Each suggestion includes:
//   - A Vega-Lite spec (the "brain")
//   - A human-readable title and description
//   - A chart type tag for the UI
//   - A relevance score (higher = more interesting)
//
// Scoring heuristics:
//   - High distinct count on a nominal → good for grouping
//   - Two numeric cols with correlation → good scatter
//   - Temporal + numeric → good time series
//   - Numeric with wide range → good histogram
// =================================================================

import type { ColumnInfo, QueryResult } from "./store";
import { VIZ_CATEGORICAL } from "./chartPalettes";
import {
  applyPreferenceBoosts,
  getCachedVizPreferences,
  type VizPreferenceModel,
} from "./vizPreferences";
import {
  ODD_CHART_KIND_OPTIONS,
  buildOddChartRec,
  getOddRandomEncoding,
  isOddChartKind,
  oddChartDataSupport,
  oddRecommendationReason,
  type OddChartKind,
} from "./oddCharts";
import {
  GPU_SCENE_KIND_OPTIONS,
  buildGpuSceneRec,
  suggestDataCubeRec,
  isGpuSceneKind,
  gpuSceneRecommendationReason,
  gpuSceneDataSupport,
  getGpuRandomEncoding,
  type GpuSceneKind,
} from "./gpuScenes";
import {
  GEO_MAP_KIND_OPTIONS,
  buildGeoMapRec,
  isGeoMapKind,
  geoMapDataSupport,
  getGeoMapRandomEncoding,
  geoMapRecommendationReason,
  type GeoMapKind,
} from "./geoMaps";
import { isGeoRegionField } from "./geoAtlas";

const COLORS = VIZ_CATEGORICAL;

const DARK_AXIS = {
  labelColor: "#6b6b78",
  titleColor: "#e8e8ec",
  gridColor: "#2a2a30",
  domainColor: "#2a2a30",
  labelFont: "JetBrains Mono, monospace",
  labelFontSize: 10,
  titleFontSize: 11,
};

export type ChartKind =
  | "scatter"
  | "bar"
  | "histogram"
  | "line"
  | "heatmap"
  | "strip"
  | "box"
  | "area"
  | "pie"
  | "bubble"
  | "violin"
  | "radar"
  | "waterfall"
  | "lollipop"
  | "dumbbell"
  | "ridgeline"
  | "hexbin"
  | "funnel"
  | "parallel"
  | "treemap"
  | "sunburst"
  | "choropleth"
  | "forceBubble"
  | "sankey"
  | OddChartKind
  | GpuSceneKind
  | GeoMapKind;

/** Aggregation for Y (or theta) encoding — sum, average, count, min, max. */
export type YAggregateOption = "sum" | "mean" | "count" | "min" | "max";

export const Y_AGGREGATE_OPTIONS: { value: YAggregateOption; label: string }[] = [
  { value: "sum", label: "Sum" },
  { value: "mean", label: "Average" },
  { value: "count", label: "Count" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
];

/** Display options for chart-type selector (dot/line/rect/pie etc). */
export const CHART_KIND_OPTIONS: { value: ChartKind; label: string }[] = [
  { value: "scatter", label: "Dot (scatter)" },
  { value: "bubble", label: "Bubble" },
  { value: "hexbin", label: "Hexbin" },
  { value: "line", label: "Line" },
  { value: "bar", label: "Bar (rect)" },
  { value: "lollipop", label: "Lollipop" },
  { value: "dumbbell", label: "Dumbbell" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
  { value: "funnel", label: "Funnel" },
  { value: "histogram", label: "Histogram" },
  { value: "waterfall", label: "Waterfall" },
  { value: "strip", label: "Strip" },
  { value: "violin", label: "Violin" },
  { value: "ridgeline", label: "Ridgeline" },
  { value: "box", label: "Box" },
  { value: "radar", label: "Radar" },
  { value: "parallel", label: "Parallel coords" },
  { value: "heatmap", label: "Heatmap" },
  { value: "treemap", label: "Treemap" },
  { value: "sunburst", label: "Sunburst" },
  { value: "forceBubble", label: "Force Bubble" },
  { value: "sankey", label: "Sankey" },
  { value: "choropleth", label: "Choropleth map" },
  ...ODD_CHART_KIND_OPTIONS,
  ...GPU_SCENE_KIND_OPTIONS,
  ...GEO_MAP_KIND_OPTIONS,
];

export interface ChartRecommendation {
  id: string;
  kind: ChartKind;
  title: string;
  subtitle: string;
  score: number;
  spec: object;
  xField: string;
  yField: string | null;
  colorField: string | null;
  /** Optional size encoding (scatter, strip). */
  sizeField?: string | null;
  /** Optional Z / depth encoding (scatter3d, terrain, iso). */
  zField?: string | null;
  /** Optional time encoding (trails, weave weft, firefly pulse). */
  timeField?: string | null;
  /** Optional entity id for trail ribbons. */
  trailId?: string | null;
  /** Optional row facet (bar, line, area). */
  rowField?: string | null;
  /** Optional glow encoding (scatter): column drives glow on/off or intensity. */
  glowField?: string | null;
  /** Optional outline encoding (scatter): column drives stroke on/off or width. */
  outlineField?: string | null;
  /** Optional opacity encoding (scatter, strip): column drives per-point opacity. */
  opacityField?: string | null;
  /** Aggregation for Y (or theta) when chart type uses it: bar, line, area, pie. */
  yAggregate?: YAggregateOption | null;
  /** Explicit tooltip column names; when unset, encoding fields are used. */
  tooltipFields?: string[] | null;
  /** Identity column for cross-chart tooltip link / lock (L key). */
  tooltipKeyField?: string | null;
}

type ColType = "quantitative" | "nominal" | "temporal";

function inferType(dt: string, colName?: string): ColType {
  const t = dt.toUpperCase();
  if (["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT", "TINYINT", "SMALLINT", "UBIGINT", "UINTEGER", "USMALLINT", "UTINYINT"].some(n => t.includes(n))) return "quantitative";
  if (["DATE", "TIMESTAMP", "TIME", "INTERVAL"].some(n => t.includes(n))) return "temporal";
  // Treat VARCHAR/STRING columns with date-like names as temporal for time-series charts
  const name = (colName ?? "").toUpperCase();
  if (["DATE", "TIME", "YEAR", "MONTH", "DAY", "INCIDENT_DATE", "CREATED_AT", "UPDATED_AT", "TIMESTAMP"].some(n => name.includes(n))) return "temporal";
  return "nominal";
}

/** Rates/% should use mean (or median), not sum — summing 10.9% across regions is nonsense. */
function isRateLikeField(name: string): boolean {
  return /(percent|percentage|proportion|ratio|rate|pct|\(%\)|%)/i.test(name);
}

/** Prefer human labels over opaque codes when both exist as categories. */
function nominalQualityBoost(name: string): number {
  const n = name.toLowerCase();
  if (/\b(name|title|label|region|state|city|county|country)\b/.test(n)) return 8;
  if (/\b(code|id|uuid|key|ref|index)\b/.test(n) || /(_id|_code)$/.test(n)) return -12;
  return 0;
}

/** Geographic coordinate pair — prefer as map-like scatter even when Pearson r is low. */
function isLatLonPair(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const lat = (s: string) => /^(lat|latitude)$/.test(s) || s.includes("latitude");
  const lon = (s: string) => /^(lon|lng|long|longitude)$/.test(s) || s.includes("longitude");
  return (lat(x) && lon(y)) || (lon(x) && lat(y));
}

/** Prefer 3–12 categories for color legends; avoid one-hot noise and binary-only when better options exist. */
function pickColorColumn(nomCols: ColumnInfo[]): ColumnInfo | null {
  const candidates = nomCols.filter((c) => c.distinct_count >= 2 && c.distinct_count <= 20);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const score = (c: ColumnInfo) => {
      let s = 0;
      const d = c.distinct_count;
      if (d >= 3 && d <= 12) s += 30;
      else if (d >= 2 && d <= 16) s += 15;
      else s += 5;
      // Mild preference for denser (less null-heavy) columns when stats exist
      if (c.null_count === 0) s += 4;
      return s;
    };
    return score(b) - score(a);
  });
  return candidates[0] ?? null;
}

function colIndex(data: QueryResult, name: string): number {
  return data.columns.indexOf(name);
}

/** Sample paired numeric values from a QueryResult (cap for speed). */
function sampleNumericPair(
  data: QueryResult | null,
  xName: string,
  yName: string,
  maxPoints = 800,
): { xs: number[]; ys: number[] } | null {
  if (!data?.rows?.length) return null;
  const xi = colIndex(data, xName);
  const yi = colIndex(data, yName);
  if (xi < 0 || yi < 0) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  const rows = data.rows;
  const step = Math.max(1, Math.floor(rows.length / maxPoints));
  for (let i = 0; i < rows.length && xs.length < maxPoints; i += step) {
    const xv = Number(rows[i][xi]);
    const yv = Number(rows[i][yi]);
    if (Number.isFinite(xv) && Number.isFinite(yv)) {
      xs.push(xv);
      ys.push(yv);
    }
  }
  return xs.length >= 12 ? { xs, ys } : null;
}

/** Absolute Pearson correlation in [0, 1]; 0 when undefined. */
function pearsonAbs(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 12) return 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (vx <= 0 || vy <= 0) return 0;
  const r = cov / Math.sqrt(vx * vy);
  return Number.isFinite(r) ? Math.min(1, Math.abs(r)) : 0;
}

/**
 * Re-rank recommendations for variety: keep high scores but avoid flooding
 * the list with the same kind / field pair. Used for Suggest chart top picks
 * and the Suggestions rail.
 */
export function diversifyRecommendations(
  recs: ChartRecommendation[],
  limit = 40,
): ChartRecommendation[] {
  if (recs.length <= 1) return recs.slice(0, limit);
  const sorted = [...recs].sort((a, b) => b.score - a.score);
  const out: ChartRecommendation[] = [];
  const kindCount = new Map<ChartKind, number>();
  const fieldKeys = new Set<string>();

  const fieldKey = (r: ChartRecommendation) =>
    `${r.kind}|${r.xField}|${r.yField ?? ""}|${r.colorField ?? ""}`;

  // First pass: prefer new kinds / encodings
  for (const r of sorted) {
    if (out.length >= limit) break;
    const kc = kindCount.get(r.kind) ?? 0;
    const fk = fieldKey(r);
    if (kc >= 4 && out.length >= Math.min(8, limit)) continue;
    if (fieldKeys.has(fk)) continue;
    out.push(r);
    kindCount.set(r.kind, kc + 1);
    fieldKeys.add(fk);
  }
  // Second pass: fill remaining slots by score
  for (const r of sorted) {
    if (out.length >= limit) break;
    if (out.some((o) => o.id === r.id)) continue;
    out.push(r);
  }
  return out;
}

function baseConfig() {
  return {
    background: "transparent",
    axis: DARK_AXIS,
    title: { color: "#e8e8ec", fontSize: 13, fontWeight: 600, font: "Inter, sans-serif" },
    legend: { labelColor: "#6b6b78", titleColor: "#e8e8ec", labelFont: "JetBrains Mono, monospace", labelFontSize: 10 },
    view: { stroke: null },
  };
}

/** Build a single scatter recommendation from chosen columns (for axis/color pickers). */
export function createScatterRec(
  columns: ColumnInfo[],
  xField: string,
  yField: string,
  colorField: string | null,
  tableName: string,
  sizeField?: string | null,
  visualEncoding?: {
    glowField?: string | null;
    outlineField?: string | null;
    opacityField?: string | null;
    tooltipFields?: string[] | null;
    tooltipKeyField?: string | null;
  },
): ChartRecommendation {
  const encoding: Record<string, unknown> = {
    x: { field: xField, type: "quantitative" },
    y: { field: yField, type: "quantitative" },
  };
  if (colorField) {
    encoding.color = { field: colorField, type: "nominal", scale: { range: COLORS } };
  }
  if (sizeField) {
    encoding.size = { field: sizeField, type: "quantitative", scale: { range: [12, 96] } };
  }
  const colorCol = colorField ? columns.find(c => c.name === colorField) : null;
  const mark: { type: "circle"; opacity: number; size?: number } = { type: "circle", opacity: 0.65 };
  if (!sizeField) mark.size = 12;
  return {
    id: `scatter-${xField}-${yField}-${colorField ?? "n"}-${sizeField ?? "n"}`,
    kind: "scatter",
    title: `${xField} vs ${yField}`,
    subtitle: sizeField ? `size by ${sizeField}` : (colorCol ? `colored by ${colorCol.name}` : "numeric relationship"),
    score: 70,
    spec: {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      mark,
      encoding,
      width: "container",
      height: "container",
      config: baseConfig(),
    },
    xField,
    yField,
    colorField,
    sizeField: sizeField ?? undefined,
    glowField: visualEncoding?.glowField ?? undefined,
    outlineField: visualEncoding?.outlineField ?? undefined,
    opacityField: visualEncoding?.opacityField ?? undefined,
    tooltipFields: visualEncoding?.tooltipFields ?? undefined,
    tooltipKeyField: visualEncoding?.tooltipKeyField ?? undefined,
  };
}

/** Kinds whose X (or slice / stage / identity) is a category. */
const CATEGORY_X_KINDS = new Set<string>([
  "bar", "lollipop", "pie", "treemap", "sunburst", "forceBubble", "funnel", "waterfall", "box", "violin",
  "beeswarm", "dumbbell", "pyramid", "slope", "radialBar", "waffle", "isotype", "isoBars", "mosaic",
  "chord", "sankey", "bucketField",
]);
/** One glyph per row/entity — an identity column (country, name) rather than a few groups. */
const IDENTITY_X_KINDS = new Set<string>(["chernoff", "glyphStar", "flower"]);
/** Kinds whose Y is the group axis. */
const CATEGORY_Y_KINDS = new Set<string>(["strip", "ridgeline"]);
/** Kinds whose X is an ordering — time reads best. */
const ORDERED_X_KINDS = new Set<string>(["line", "area", "bump", "stream", "horizon", "spiral"]);
/** Kinds where Color is a required second category (target / segment). */
const CATEGORY_COLOR_KINDS = new Set<string>(["mosaic", "chord", "sankey"]);

/**
 * Adapt an encoding when switching chart type: keep fields that suit the new kind,
 * and swap in a fitting column where they don't — so turning a units × revenue
 * scatter into a bar groups by a real category instead of 500 distinct numbers.
 */
export function fitEncodingToKind(
  kind: ChartKind,
  columns: ColumnInfo[],
  enc: { xField: string; yField: string | null; colorField: string | null },
): { xField: string; yField: string | null; colorField: string | null } {
  const byName = new Map(columns.map((c) => [c.name, c]));
  const typeOf = (c: ColumnInfo) => inferType(c.data_type, c.name);
  /** A column that reads well as discrete groups. */
  const isCategory = (name: string | null, max = 40): boolean => {
    const c = name ? byName.get(name) : undefined;
    if (!c) return false;
    const t = typeOf(c);
    if (c.distinct_count < 2) return false;
    if (t === "quantitative") return c.distinct_count <= Math.min(24, max);
    return c.distinct_count <= max;
  };
  const nominal = columns.filter((c) => typeOf(c) === "nominal" && c.distinct_count >= 2);
  const bestCategory = (exclude: Set<string | null>, identity = false): string | null => {
    const pool = nominal.filter((c) => !exclude.has(c.name));
    if (identity) {
      // Most distinct values that still fit a glyph grid / list (country, name…)
      const ids = pool.filter((c) => c.distinct_count <= 400).sort((a, b) => b.distinct_count - a.distinct_count);
      return ids[0]?.name ?? null;
    }
    // A handful of groups reads best: prefer 3–20, then anything up to 40
    const score = (c: ColumnInfo) => (c.distinct_count >= 3 && c.distinct_count <= 20 ? 0 : 1) * 1000 + Math.abs(c.distinct_count - 8);
    const fits = pool.filter((c) => c.distinct_count <= 40).sort((a, b) => score(a) - score(b));
    return fits[0]?.name ?? null;
  };
  const isNumeric = (name: string | null) => {
    const c = name ? byName.get(name) : undefined;
    return !!c && typeOf(c) === "quantitative";
  };

  let { xField, yField, colorField } = enc;

  if (kind === "choropleth") {
    const region = columns.find((c) => isGeoRegionField(c.name) && c.distinct_count >= 3);
    if (!isGeoRegionField(xField) && region) xField = region.name;
  } else if (IDENTITY_X_KINDS.has(kind)) {
    if (!(isCategory(xField, 400) && !isNumeric(xField))) xField = bestCategory(new Set([yField, colorField]), true) ?? xField;
  } else if (CATEGORY_X_KINDS.has(kind)) {
    if (!isCategory(xField)) {
      // The color field is often the best grouping — promote it to X rather than give up
      const alt = bestCategory(new Set([yField, colorField])) ?? (isCategory(colorField) ? colorField : null);
      if (alt) {
        if (alt === colorField) colorField = null;
        xField = alt;
      }
    }
    // The measure must be numeric (or none → count)
    if (yField && !isNumeric(yField)) yField = null;
  } else if (CATEGORY_Y_KINDS.has(kind)) {
    if (!isCategory(yField)) {
      const alt = bestCategory(new Set([xField, colorField])) ?? (isCategory(colorField) ? colorField : null);
      if (alt) {
        if (alt === colorField) colorField = null;
        yField = alt;
      }
    }
    if (!isNumeric(xField)) xField = columns.find((c) => typeOf(c) === "quantitative" && c.name !== yField)?.name ?? xField;
  }

  if (ORDERED_X_KINDS.has(kind)) {
    const isTimeLike = (c: ColumnInfo) => typeOf(c) === "temporal" || /^(year|yr|date|day|month|week|ts|time)$/i.test(c.name);
    const cur = byName.get(xField);
    if (!cur || !isTimeLike(cur)) {
      const time = columns.find((c) => isTimeLike(c) && c.name !== yField && c.distinct_count >= 3);
      if (time) xField = time.name;
    }
  }

  // One mark per category: a color field that isn't the category would color each mark by
  // whichever row came first — meaningless (e.g. a lollipop per product colored by city)
  if (["lollipop", "funnel", "waterfall", "pie", "radialBar", "isotype", "waffle", "isoBars"].includes(kind) && colorField !== xField) {
    colorField = null;
  }

  // Color must be a small set of groups; required kinds get the next-best category
  if (colorField && colorField !== xField && !isCategory(colorField, 12)) colorField = null;
  if (CATEGORY_COLOR_KINDS.has(kind) && (!colorField || colorField === xField)) {
    // Flows show their top nodes, so a large category (e.g. 142 countries) still works
    colorField = bestCategory(new Set([xField, yField])) ?? bestCategory(new Set([xField, yField]), true) ?? colorField;
  }
  return { xField, yField, colorField };
}

/** Build a chart recommendation for any kind from chosen columns (for drag-drop encoding in panel). */
export function createChartRec(
  kind: ChartKind,
  columns: ColumnInfo[],
  xField: string,
  yField: string | null,
  colorField: string | null,
  tableName: string,
  extra?: {
    sizeField?: string | null;
    zField?: string | null;
    timeField?: string | null;
    trailId?: string | null;
    rowField?: string | null;
    glowField?: string | null;
    outlineField?: string | null;
    opacityField?: string | null;
    yAggregate?: YAggregateOption | null;
    tooltipFields?: string[] | null;
    tooltipKeyField?: string | null;
    barStackMode?: "grouped" | "stacked" | "percent";
  },
): ChartRecommendation | null {
  const numCols = columns.filter(c => inferType(c.data_type, c.name) === "quantitative");
  const nomCols = columns.filter(c => inferType(c.data_type, c.name) === "nominal");
  const timeCols = columns.filter(c => inferType(c.data_type, c.name) === "temporal");
  let sizeField = extra?.sizeField ?? null;
  const rowField = extra?.rowField ?? null;
  const glowField = extra?.glowField ?? null;
  const outlineField = extra?.outlineField ?? null;
  const opacityField = extra?.opacityField ?? null;
  const yAggregate = extra?.yAggregate ?? null;
  const barStackMode = extra?.barStackMode ?? "grouped";

  if (kind === "scatter") {
    if (!yField || !numCols.some(c => c.name === xField) || !numCols.some(c => c.name === yField)) return null;
    return createScatterRec(columns, xField, yField, colorField, tableName, sizeField, {
      glowField,
      outlineField,
      opacityField,
      tooltipFields: extra?.tooltipFields,
      tooltipKeyField: extra?.tooltipKeyField ?? undefined,
    });
  }

  const barFacetId =
    kind === "bar" &&
    Boolean(colorField && colorField !== xField && nomCols.some((c) => c.name === colorField));
  const id = `${kind}-${xField}-${yField ?? "n"}-${colorField ?? "n"}${rowField ? `-row:${rowField}` : ""}${barFacetId ? `-${barStackMode}` : ""}`;
  const enc: Record<string, unknown> = {};
  let title = "";
  let subtitle = "";

  /** Default aggregate when a measure column is used; count when no yField. */
  const aggForMeasure = (defaultAgg: YAggregateOption): YAggregateOption =>
    !yField ? "count" : (yAggregate ?? defaultAgg);
  const aggLabel = (a: YAggregateOption) =>
    a === "mean" ? "Average" : a === "sum" ? "Sum" : a === "count" ? "Count" : a === "min" ? "Min" : "Max";

  switch (kind) {
    case "bar": {
      const agg = aggForMeasure("sum");
      enc.x = { field: xField, type: "nominal", sort: "-y" };
      const yEnc: Record<string, unknown> = yField
        ? { field: yField, type: "quantitative", aggregate: agg }
        : { aggregate: "count", type: "quantitative" };
      const subOk = Boolean(
        colorField && colorField !== xField && nomCols.some((c) => c.name === colorField),
      );
      if (subOk && colorField) {
        enc.color = { field: colorField, type: "nominal", scale: { range: COLORS } };
        if (barStackMode === "grouped") {
          enc.xOffset = { field: colorField, type: "nominal" };
        } else if (barStackMode === "percent") {
          yEnc.stack = "normalize";
        }
      } else {
        enc.color = { value: COLORS[0] };
      }
      enc.y = yEnc;
      if (rowField) enc.row = { field: rowField, type: "nominal", header: { title: rowField } };
      title = yField ? `${aggLabel(agg)} of ${yField} by ${xField}` : `Count by ${xField}`;
      if (subOk && colorField) {
        title += ` × ${colorField}`;
        if (barStackMode === "grouped") subtitle = rowField ? `dodged by ${colorField}; facets by ${rowField}` : `grouped by ${colorField}`;
        else if (barStackMode === "stacked") subtitle = rowField ? `stacked by ${colorField}; facets by ${rowField}` : `stacked by ${colorField}`;
        else subtitle = rowField ? `100% stacked by ${colorField}; facets by ${rowField}` : `100% stacked by ${colorField}`;
      } else {
        subtitle = rowField ? `by ${rowField}` : (yField ? "grouped" : "rows per category");
      }
      break;
    }
    case "histogram":
      enc.x = { field: xField, type: "quantitative", bin: { maxbins: 30 } };
      enc.y = { aggregate: "count", type: "quantitative" };
      enc.color = { value: COLORS[1] };
      title = `Distribution of ${xField}`;
      subtitle = "binned count";
      break;
    case "line": {
      const agg = aggForMeasure("mean");
      enc.x = { field: xField, type: "temporal" };
      enc.y = yField ? { field: yField, type: "quantitative", aggregate: agg } : { aggregate: "count", type: "quantitative" };
      if (colorField) enc.color = { field: colorField, type: "nominal", scale: { range: COLORS } };
      if (rowField) enc.row = { field: rowField, type: "nominal", header: { title: rowField } };
      title = yField ? `${yField} (${aggLabel(agg)}) over ${xField}` : `Count over ${xField}`;
      subtitle = rowField ? `by ${rowField}` : (colorField ? `split by ${colorField}` : "time trend");
      break;
    }
    case "heatmap":
      if (!yField) return null;
      enc.x = { field: xField, type: "nominal" };
      enc.y = { field: yField, type: "nominal" };
      enc.color = { aggregate: "count", type: "quantitative", scale: { scheme: "purples" } };
      title = `${xField} × ${yField}`;
      subtitle = "count heatmap";
      break;
    case "strip":
      if (!yField) return null;
      enc.x = { field: xField, type: "quantitative" };
      enc.y = { field: yField, type: "nominal" };
      enc.color = colorField
        ? { field: colorField, type: "nominal", scale: { range: COLORS } }
        : { field: yField, type: "nominal", scale: { range: COLORS }, legend: null };
      if (sizeField) enc.size = { field: sizeField, type: "quantitative", scale: { range: [2, 12] } };
      title = `${xField} by ${yField}`;
      subtitle = colorField ? `colored by ${colorField}` : (sizeField ? `size by ${sizeField}` : "strip plot");
      break;
    case "box":
      if (!yField) return null;
      enc.x = { field: xField, type: "nominal" };
      enc.y = { field: yField, type: "quantitative" };
      enc.color = { value: COLORS[2] };
      title = `${yField} by ${xField}`;
      subtitle = "box plot";
      break;
    case "area": {
      const agg = aggForMeasure("sum");
      enc.x = { field: xField, type: "temporal" };
      enc.y = yField ? { field: yField, type: "quantitative", aggregate: agg } : { aggregate: "count", type: "quantitative" };
      if (colorField) enc.color = { field: colorField, type: "nominal", scale: { range: COLORS } };
      if (rowField) enc.row = { field: rowField, type: "nominal", header: { title: rowField } };
      title = yField ? `${yField} (${aggLabel(agg)}) over ${xField}` : `Count over ${xField}`;
      subtitle = rowField ? `by ${rowField}` : (colorField ? `stacked by ${colorField}` : "area");
      break;
    }
    case "pie": {
      const agg = aggForMeasure("sum");
      enc.theta = yField
        ? { field: yField, type: "quantitative", aggregate: agg }
        : { aggregate: "count", type: "quantitative" };
      enc.color = { field: xField, type: "nominal", scale: { range: COLORS } };
      title = yField ? `${aggLabel(agg)} of ${yField} by ${xField}` : `Count by ${xField}`;
      subtitle = "donut";
      break;
    }
    case "bubble": {
      if (!yField) return null;
      // Compare like with like: skip time-ish numbers (year) as the "end" measure
      sizeField = sizeField
        ?? numCols.find(c => c.name !== xField && c.name !== yField && !/^(year|yr|month|day|week|hour)$/i.test(c.name))?.name
        ?? numCols.find(c => c.name !== xField && c.name !== yField)?.name
        ?? null;
      enc.x = { field: xField, type: "quantitative" };
      enc.y = { field: yField, type: "quantitative" };
      if (sizeField) enc.size = { field: sizeField, type: "quantitative", scale: { range: [16, 120] } };
      if (colorField) enc.color = { field: colorField, type: "nominal", scale: { range: COLORS } };
      title = sizeField ? `${xField} vs ${yField} sized by ${sizeField}` : `${xField} vs ${yField}`;
      subtitle = colorField ? `colored by ${colorField}` : (sizeField ? "three-variable relationship" : "bubble chart");
      break;
    }
    case "violin": {
      if (!yField) return null;
      enc.x = { field: xField, type: "nominal" };
      enc.y = { field: yField, type: "quantitative" };
      if (colorField) enc.color = { field: colorField, type: "nominal", scale: { range: COLORS } };
      title = `${yField} distribution by ${xField}`;
      subtitle = "violin — density per group";
      break;
    }
    case "radar": {
      enc.x = { field: xField, type: "nominal" };
      enc.y = yField
        ? { field: yField, type: "quantitative", aggregate: yAggregate ?? "mean" }
        : { aggregate: "count", type: "quantitative" };
      if (colorField) enc.color = { field: colorField, type: "nominal", scale: { range: COLORS } };
      title = yField ? `${yField} by ${xField}` : `Count by ${xField}`;
      subtitle = "radar / spider chart";
      break;
    }
    case "waterfall": {
      const agg = aggForMeasure("sum");
      enc.x = { field: xField, type: "nominal" };
      enc.y = yField
        ? { field: yField, type: "quantitative", aggregate: agg }
        : { aggregate: "count", type: "quantitative" };
      title = yField ? `${aggLabel(agg)} of ${yField} — waterfall` : `Count waterfall`;
      subtitle = "cumulative gains and losses";
      break;
    }
    case "lollipop": {
      const agg = aggForMeasure("sum");
      enc.x = { field: xField, type: "nominal", sort: "-y" };
      enc.y = yField
        ? { field: yField, type: "quantitative", aggregate: agg }
        : { aggregate: "count", type: "quantitative" };
      enc.color = colorField
        ? { field: colorField, type: "nominal", scale: { range: COLORS } }
        : { value: COLORS[0] };
      title = yField ? `${aggLabel(agg)} of ${yField} by ${xField}` : `Count by ${xField}`;
      subtitle = colorField ? `colored by ${colorField}` : "lollipop — stem + dot";
      break;
    }
    case "dumbbell": {
      if (!yField) return null;
      sizeField = sizeField
        ?? numCols.find(c => c.name !== xField && c.name !== yField)?.name
        ?? null;
      if (!sizeField || sizeField === yField) return null;
      enc.x = { field: xField, type: "nominal" };
      enc.y = { field: yField, type: "quantitative", aggregate: yAggregate ?? "mean" };
      enc.size = { field: sizeField, type: "quantitative", aggregate: yAggregate ?? "mean" };
      if (colorField) enc.color = { field: colorField, type: "nominal", scale: { range: COLORS } };
      title = `${yField} → ${sizeField} by ${xField}`;
      subtitle = colorField ? `dumbbell · split by ${colorField}` : "dumbbell — start to end";
      break;
    }
    case "ridgeline": {
      if (!yField) return null;
      enc.x = { field: xField, type: "quantitative" };
      enc.y = { field: yField, type: "nominal" };
      if (colorField) enc.color = { field: colorField, type: "nominal", scale: { range: COLORS } };
      title = `${xField} ridges by ${yField}`;
      subtitle = "ridgeline — overlapping densities";
      break;
    }
    case "hexbin": {
      if (!yField) return null;
      enc.x = { field: xField, type: "quantitative", bin: { maxbins: 20 } };
      enc.y = { field: yField, type: "quantitative", bin: { maxbins: 20 } };
      enc.color = { aggregate: "count", type: "quantitative", scale: { scheme: "viridis" } };
      title = `${xField} × ${yField}`;
      subtitle = "hexbin — density tiles";
      break;
    }
    case "funnel": {
      const agg = aggForMeasure("sum");
      enc.x = { field: xField, type: "nominal", sort: "-y" };
      enc.y = yField
        ? { field: yField, type: "quantitative", aggregate: agg }
        : { aggregate: "count", type: "quantitative" };
      if (colorField) enc.color = { field: colorField, type: "nominal", scale: { range: COLORS } };
      title = yField ? `${aggLabel(agg)} of ${yField} funnel` : `Count funnel by ${xField}`;
      subtitle = "funnel — stage conversion";
      break;
    }
    case "parallel": {
      if (numCols.length < 3) return null;
      enc.x = { field: xField, type: "quantitative" };
      enc.y = yField
        ? { field: yField, type: "quantitative" }
        : { field: numCols.find(c => c.name !== xField)?.name ?? xField, type: "quantitative" };
      if (colorField) enc.color = { field: colorField, type: "nominal", scale: { range: COLORS } };
      title = `Parallel: ${numCols.slice(0, 6).map(c => c.name).join(", ")}`;
      subtitle = colorField ? `profiles by ${colorField}` : "parallel coordinates";
      break;
    }
    case "treemap": {
      const agg = aggForMeasure("sum");
      enc.x = { field: xField, type: "nominal" };
      enc.y = yField
        ? { field: yField, type: "quantitative", aggregate: agg }
        : { aggregate: "count", type: "quantitative" };
      if (colorField) enc.color = { field: colorField, type: "nominal", scale: { range: COLORS } };
      title = yField ? `${aggLabel(agg)} of ${yField} by ${xField}` : `Count by ${xField}`;
      subtitle = colorField ? `nested by ${colorField}` : "treemap";
      break;
    }
    case "sunburst": {
      const agg = aggForMeasure("sum");
      enc.theta = yField
        ? { field: yField, type: "quantitative", aggregate: agg }
        : { aggregate: "count", type: "quantitative" };
      enc.color = { field: xField, type: "nominal", scale: { range: COLORS } };
      title = yField ? `${aggLabel(agg)} of ${yField} by ${xField}` : `Count by ${xField}`;
      subtitle = colorField ? `inner ring: ${colorField}` : "sunburst";
      break;
    }
    case "choropleth": {
      enc.x = { field: xField, type: "nominal" };
      enc.y = yField
        ? { field: yField, type: "quantitative" }
        : { aggregate: "count", type: "quantitative" };
      title = yField ? `${yField} by region` : `Count by region`;
      subtitle = `filled polygons — ${xField}`;
      break;
    }
    case "forceBubble": {
      const agg = aggForMeasure("sum");
      enc.x = { field: xField, type: "nominal" };
      enc.y = yField
        ? { field: yField, type: "quantitative", aggregate: agg }
        : { aggregate: "count", type: "quantitative" };
      if (colorField) enc.color = { field: colorField, type: "nominal", scale: { range: COLORS } };
      title = yField ? `${aggLabel(agg)} of ${yField} by ${xField}` : `Count by ${xField}`;
      subtitle = "packed circles — size = value";
      break;
    }
    case "sankey": {
      // Color = flow target (required). Y = optional numeric weight; else row count.
      const target =
        colorField && nomCols.some((c) => c.name === colorField)
          ? colorField
          : yField && nomCols.some((c) => c.name === yField)
            ? yField
            : null;
      if (!target || target === xField) return null;
      const weightOk = Boolean(yField && numCols.some((c) => c.name === yField));
      enc.x = { field: xField, type: "nominal" };
      enc.color = { field: target, type: "nominal", scale: { range: COLORS } };
      enc.y = weightOk
        ? { field: yField!, type: "quantitative", aggregate: "sum" }
        : { aggregate: "count", type: "quantitative" };
      title = `${xField} → ${target}`;
      subtitle = weightOk ? `weighted by ${yField}` : "flow between categories";
      break;
    }
    default: {
      if (isGpuSceneKind(kind)) {
        return buildGpuSceneRec(kind, columns, xField, yField, colorField, {
          sizeField,
          zField: extra?.zField,
          timeField: extra?.timeField,
          trailId: extra?.trailId,
          yAggregate,
        });
      }
      if (isGeoMapKind(kind)) {
        return buildGeoMapRec(kind, columns, xField, yField, colorField, {
          sizeField,
          yAggregate,
        });
      }
      if (isOddChartKind(kind)) {
        return buildOddChartRec(kind, columns, xField, yField, colorField, tableName, {
          sizeField,
          yAggregate,
        });
      }
      return null;
    }
  }

  const mark =
    kind === "line" ? { type: "line" as const, strokeWidth: 1.5 } :
    kind === "area" ? { type: "area" as const, line: true, opacity: 0.7 } :
    kind === "histogram" ? { type: "bar" as const, cornerRadiusTopLeft: 2, cornerRadiusTopRight: 2 } :
    kind === "bar" ? { type: "bar" as const, cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 } :
    kind === "box" ? { type: "boxplot" as const, extent: "min-max" } :
    kind === "strip" ? { type: "tick" as const, thickness: 1.5 } :
    kind === "pie" ? { type: "arc" as const, innerRadius: 40 } :
    kind === "bubble" ? { type: "circle" as const, opacity: 0.65 } :
    kind === "violin" ? { type: "area" as const, orient: "horizontal" as const, opacity: 0.7 } :
    kind === "radar" ? { type: "line" as const, strokeWidth: 1.5 } :
    kind === "waterfall" ? { type: "bar" as const, cornerRadiusTopLeft: 2, cornerRadiusTopRight: 2 } :
    kind === "lollipop" ? { type: "circle" as const, size: 60 } :
    kind === "dumbbell" ? { type: "rule" as const } :
    kind === "ridgeline" ? { type: "area" as const, opacity: 0.55 } :
    kind === "hexbin" ? { type: "rect" as const } :
    kind === "funnel" ? { type: "bar" as const, cornerRadius: 2 } :
    kind === "parallel" ? { type: "line" as const, opacity: 0.45 } :
    kind === "treemap" ? { type: "rect" as const } :
    kind === "sunburst" ? { type: "arc" as const } :
    kind === "choropleth" ? { type: "geoshape" as const } :
    kind === "forceBubble" ? { type: "circle" as const, opacity: 0.75 } :
    kind === "sankey" ? { type: "rect" as const } :
    "rect";

  const effectiveYAggregate: YAggregateOption | undefined =
    (kind === "bar" || kind === "line" || kind === "area" || kind === "pie" || kind === "waterfall" || kind === "lollipop" || kind === "radar" || kind === "treemap" || kind === "sunburst" || kind === "forceBubble" || kind === "funnel" || kind === "dumbbell")
      ? (!yField ? "count" : (yAggregate ?? (kind === "line" || kind === "dumbbell" ? "mean" : "sum")))
      : undefined;

  return {
    id,
    kind,
    title,
    subtitle,
    score: 65,
    spec: {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      mark: mark === "rect" ? "rect" : mark,
      encoding: enc,
      width: "container",
      height: "container",
      config: baseConfig(),
    },
    xField,
    yField,
    colorField,
    sizeField: sizeField ?? undefined,
    rowField: rowField ?? undefined,
    glowField: glowField ?? undefined,
    outlineField: outlineField ?? undefined,
    opacityField: opacityField ?? undefined,
    yAggregate: effectiveYAggregate ?? undefined,
    tooltipFields: extra?.tooltipFields,
    tooltipKeyField: extra?.tooltipKeyField,
  };
}

export function recommend(
  columns: ColumnInfo[],
  data: QueryResult | null,
  fileName: string,
  prefs?: VizPreferenceModel | null,
): ChartRecommendation[] {
  const recs: ChartRecommendation[] = [];
  const name = fileName.replace(/\.\w+$/, "");
  const nRows = data?.rows?.length ?? 0;
  const dense = nRows >= 2500;
  const veryDense = nRows >= 6000;

  const numCols = columns.filter(c => inferType(c.data_type, c.name) === "quantitative");
  const nomCols = columns.filter(c => inferType(c.data_type, c.name) === "nominal");
  const timeCols = columns.filter(c => inferType(c.data_type, c.name) === "temporal");

  // Dense bivariate → density heatmap beats a bubble soup
  if (dense && numCols.length >= 2) {
    const a = numCols[0]!;
    const b = numCols[1]!;
    recs.push({
      id: `heatmap-density-${a.name}-${b.name}`,
      kind: "heatmap",
      title: `${a.name} × ${b.name} density`,
      subtitle: veryDense
        ? `${nRows.toLocaleString()} rows · binned (clearer than bubbles)`
        : "binned density · less overplotting",
      score: veryDense ? 94 : 86,
      spec: {},
      xField: a.name,
      yField: b.name,
      colorField: null,
    });
  }

  // --- SCATTER: every pair of numeric columns ---
  const colorCol = pickColorColumn(nomCols);
  for (let i = 0; i < numCols.length && i < 5; i++) {
    for (let j = i + 1; j < numCols.length && j < 6; j++) {
      const x = numCols[i]!;
      const y = numCols[j]!;

      const encoding: Record<string, unknown> = {
        x: { field: x.name, type: "quantitative" },
        y: { field: y.name, type: "quantitative" },
      };
      if (colorCol) {
        encoding.color = { field: colorCol.name, type: "nominal", scale: { range: COLORS } };
      }

      let score = 68;
      if (x.distinct_count > 50 && y.distinct_count > 50) score += 12;
      if (colorCol && colorCol.distinct_count >= 3 && colorCol.distinct_count <= 12) score += 12;
      else if (colorCol) score += 6;
      if (dense) score += 4;

      const geoPair = isLatLonPair(x.name, y.name);
      // Sample correlation: strong relationships beat arbitrary numeric pairs
      const pair = sampleNumericPair(data, x.name, y.name);
      let corrNote = "numeric relationship";
      if (geoPair) {
        score += 28; // map-like layout beats noise correlation penalty
        corrNote = "geographic coordinates";
      } else if (pair) {
        const absR = pearsonAbs(pair.xs, pair.ys);
        if (absR >= 0.75) {
          score += 22;
          corrNote = `strong correlation (|r|≈${absR.toFixed(2)})`;
        } else if (absR >= 0.45) {
          score += 14;
          corrNote = `moderate correlation (|r|≈${absR.toFixed(2)})`;
        } else if (absR >= 0.2) {
          score += 6;
          corrNote = `weak correlation (|r|≈${absR.toFixed(2)})`;
        } else {
          score -= 4; // near-noise pair: still show, but rank lower
          corrNote = "loose cloud (low correlation)";
        }
      }

      recs.push({
        id: `scatter-${x.name}-${y.name}`,
        kind: "scatter",
        title: geoPair
          ? (x.name.toLowerCase().includes("lon") ? `${y.name} × ${x.name}` : `${x.name} × ${y.name}`)
          : `${x.name} vs ${y.name}`,
        subtitle: colorCol ? `${corrNote} · colored by ${colorCol.name}` : corrNote,
        score,
        spec: {
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          mark: { type: "circle", opacity: 0.65, size: 12 },
          encoding,
          width: "container", height: "container",
          config: baseConfig(),
        },
        xField: x.name,
        yField: y.name,
        colorField: colorCol?.name ?? null,
      });
    }
  }

  // --- BAR: each nominal × each numeric (sum) — allow up to 50 categories (e.g. US states) ---
  for (const nom of nomCols.slice(0, 5)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 50) continue;
    for (const num of numCols.slice(0, 4)) {
      const rate = isRateLikeField(num.name);
      let score = 62;
      if (nom.distinct_count >= 3 && nom.distinct_count <= 20) score += 15;
      score += nominalQualityBoost(nom.name);
      if (rate) score -= 35; // summing %/rates is almost always wrong

      recs.push({
        id: `bar-sum-${nom.name}-${num.name}`,
        kind: "bar",
        title: `Sum of ${num.name} by ${nom.name}`,
        subtitle: rate ? `⚠ sum of rates — prefer average` : `total ${num.name}, grouped`,
        score,
        spec: {
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          mark: { type: "bar", cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 },
          encoding: {
            x: { field: nom.name, type: "nominal", sort: "-y" },
            y: { field: num.name, type: "quantitative", aggregate: "sum" },
            color: { value: COLORS[0] },
          },
          width: "container", height: "container",
          config: baseConfig(),
        },
        xField: nom.name,
        yField: num.name,
        colorField: null,
        yAggregate: "sum",
      });
    }
  }

  // --- BAR: nominal × numeric (mean) — good for "average cost by state" / rates ---
  for (const nom of nomCols.slice(0, 4)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 40) continue;
    for (const num of numCols.slice(0, 4)) {
      const rate = isRateLikeField(num.name);
      let score = 58;
      if (nom.distinct_count >= 3 && nom.distinct_count <= 20) score += 10;
      score += nominalQualityBoost(nom.name);
      if (rate) score += 30; // prefer mean for % / proportion columns

      recs.push({
        id: `bar-mean-${nom.name}-${num.name}`,
        kind: "bar",
        title: rate
          ? `${num.name.replace(/\s*\(%\)\s*$/, "").replace(/\s+/g, " ").trim()} by ${nom.name}`
          : `Average ${num.name} by ${nom.name}`,
        subtitle: rate ? `rate / proportion (mean)` : `mean per group`,
        score,
        spec: {
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          mark: { type: "bar", cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 },
          encoding: {
            x: { field: nom.name, type: "nominal", sort: "-y" },
            y: { field: num.name, type: "quantitative", aggregate: "mean" },
            color: { value: COLORS[1] },
          },
          width: "container", height: "container",
          config: baseConfig(),
        },
        xField: nom.name,
        yField: num.name,
        colorField: null,
        yAggregate: "mean",
      });
    }
  }

  // --- BAR: count by category (nominal × row count) ---
  for (const nom of nomCols.slice(0, 5)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 50) continue;
    recs.push({
      id: `bar-count-${nom.name}`,
      kind: "bar",
      title: `Count by ${nom.name}`,
      subtitle: "number of rows per category",
      score: 55,
      spec: {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        mark: { type: "bar", cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 },
        encoding: {
          x: { field: nom.name, type: "nominal", sort: "-y" },
          y: { aggregate: "count", type: "quantitative" },
          color: { value: COLORS[2] },
        },
        width: "container", height: "container",
        config: baseConfig(),
      },
      xField: nom.name,
      yField: null, // no numeric field; we use count
      colorField: null,
    });
  }

  // --- BAR: category × subcategory × numeric (dodged bars) ---
  for (const xNom of nomCols.slice(0, 4)) {
    if (xNom.distinct_count < 2 || xNom.distinct_count > 25) continue;
    for (const cNom of nomCols) {
      if (cNom.name === xNom.name) continue;
      if (cNom.distinct_count < 2 || cNom.distinct_count > 18) continue;
      for (const num of numCols.slice(0, 3)) {
        const rate = isRateLikeField(num.name);
        let score = 64;
        if (xNom.distinct_count <= 8 && cNom.distinct_count >= 3) score += 8;
        if (rate) score -= 35;
        recs.push({
          id: `bar-facet-sum-${xNom.name}-${cNom.name}-${num.name}`,
          kind: "bar",
          title: `Sum of ${num.name} by ${xNom.name} × ${cNom.name}`,
          subtitle: rate ? `⚠ sum of rates — prefer average` : `grouped by ${cNom.name}`,
          score,
          spec: {
            $schema: "https://vega.github.io/schema/vega-lite/v5.json",
            mark: { type: "bar", cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 },
            encoding: {
              x: { field: xNom.name, type: "nominal", sort: "-y" },
              y: { field: num.name, type: "quantitative", aggregate: "sum" },
              xOffset: { field: cNom.name, type: "nominal" },
              color: { field: cNom.name, type: "nominal", scale: { range: COLORS } },
            },
            width: "container",
            height: "container",
            config: baseConfig(),
          },
          xField: xNom.name,
          yField: num.name,
          colorField: cNom.name,
        });
      }
    }
  }

  // --- BAR: count by category × subcategory ---
  for (const xNom of nomCols.slice(0, 4)) {
    if (xNom.distinct_count < 2 || xNom.distinct_count > 25) continue;
    for (const cNom of nomCols) {
      if (cNom.name === xNom.name) continue;
      if (cNom.distinct_count < 2 || cNom.distinct_count > 18) continue;
      recs.push({
        id: `bar-facet-count-${xNom.name}-${cNom.name}`,
        kind: "bar",
        title: `Count by ${xNom.name} × ${cNom.name}`,
        subtitle: `rows per ${xNom.name} and ${cNom.name}`,
        score: 60,
        spec: {
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          mark: { type: "bar", cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 },
          encoding: {
            x: { field: xNom.name, type: "nominal", sort: "-y" },
            y: { aggregate: "count", type: "quantitative" },
            xOffset: { field: cNom.name, type: "nominal" },
            color: { field: cNom.name, type: "nominal", scale: { range: COLORS } },
          },
          width: "container",
          height: "container",
          config: baseConfig(),
        },
        xField: xNom.name,
        yField: null,
        colorField: cNom.name,
      });
    }
  }

  // --- HISTOGRAM: each numeric column ---
  for (const num of numCols.slice(0, 5)) {
    let score = 50;
    if (num.distinct_count > 20) score += 15;
    const range = Number(num.max_value) - Number(num.min_value);
    if (range > 0) score += 5;

    recs.push({
      id: `hist-${num.name}`,
      kind: "histogram",
      title: `Distribution of ${num.name}`,
      subtitle: `${num.min_value} → ${num.max_value}`,
      score,
      spec: {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        mark: { type: "bar", cornerRadiusTopLeft: 2, cornerRadiusTopRight: 2 },
        encoding: {
          x: { field: num.name, type: "quantitative", bin: { maxbins: 30 } },
          y: { aggregate: "count", type: "quantitative" },
          color: { value: COLORS[1] },
        },
        width: "container", height: "container",
        config: baseConfig(),
      },
      xField: num.name,
      yField: null,
      colorField: null,
    });
  }

  // --- LINE (time series): temporal × numeric ---
  for (const time of timeCols.slice(0, 2)) {
    for (const num of numCols.slice(0, 4)) {
      const groupCol = pickColorColumn(nomCols.filter((c) => c.distinct_count <= 12));
      let score = 82; // time trends are usually the most actionable story
      if (groupCol) score += 10;

      const encoding: Record<string, unknown> = {
        x: { field: time.name, type: "temporal" },
        y: { field: num.name, type: "quantitative", aggregate: "mean" },
      };
      if (groupCol) {
        encoding.color = { field: groupCol.name, type: "nominal", scale: { range: COLORS } };
      }

      recs.push({
        id: `line-${time.name}-${num.name}`,
        kind: "line",
        title: `${num.name} over ${time.name}`,
        subtitle: groupCol ? `split by ${groupCol.name}` : "time trend",
        score,
        spec: {
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          mark: { type: "line", strokeWidth: 1.5 },
          encoding,
          width: "container", height: "container",
          config: baseConfig(),
        },
        xField: time.name,
        yField: num.name,
        colorField: groupCol?.name ?? null,
      });
    }
  }

  // --- STRIP PLOT: nominal × numeric (shows distribution per group) ---
  for (const nom of nomCols.slice(0, 3)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 15) continue;
    for (const num of numCols.slice(0, 3)) {
      recs.push({
        id: `strip-${nom.name}-${num.name}`,
        kind: "strip",
        title: `${num.name} by ${nom.name}`,
        subtitle: "strip plot — distribution per group",
        score: 55,
        spec: {
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          mark: { type: "tick", thickness: 1.5 },
          encoding: {
            x: { field: num.name, type: "quantitative" },
            y: { field: nom.name, type: "nominal" },
            color: { field: nom.name, type: "nominal", scale: { range: COLORS }, legend: null },
          },
          width: "container", height: "container",
          config: baseConfig(),
        },
        xField: num.name,
        yField: nom.name,
        colorField: nom.name,
      });
    }
  }

  // --- BOX PLOT: nominal × numeric (distribution per category) ---
  for (const nom of nomCols.slice(0, 4)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 20) continue;
    for (const num of numCols.slice(0, 4)) {
      recs.push({
        id: `box-${nom.name}-${num.name}`,
        kind: "box",
        title: `${num.name} by ${nom.name}`,
        subtitle: "box plot — quartiles per group",
        score: 68,
        spec: {
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          mark: { type: "boxplot", extent: "min-max" },
          encoding: {
            x: { field: nom.name, type: "nominal" },
            y: { field: num.name, type: "quantitative" },
            color: { value: COLORS[2] },
          },
          width: "container", height: "container",
          config: baseConfig(),
        },
        xField: nom.name,
        yField: num.name,
        colorField: null,
      });
    }
  }

  // --- AREA (stacked): temporal or nominal × numeric ---
  for (const time of timeCols.slice(0, 2)) {
    for (const num of numCols.slice(0, 3)) {
      const groupCol = nomCols.length > 0 && nomCols[0].distinct_count <= 12 ? nomCols[0] : null;
      const encoding: Record<string, unknown> = {
        x: { field: time.name, type: "temporal" },
        y: { field: num.name, type: "quantitative", aggregate: "sum" },
      };
      if (groupCol) {
        encoding.color = { field: groupCol.name, type: "nominal", scale: { range: COLORS } };
      }
      recs.push({
        id: `area-${time.name}-${num.name}`,
        kind: "area",
        title: `${num.name} over ${time.name}`,
        subtitle: groupCol ? `stacked by ${groupCol.name}` : "area trend",
        score: 72,
        spec: {
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          mark: { type: "area", line: true, opacity: 0.7 },
          encoding,
          width: "container", height: "container",
          config: baseConfig(),
        },
        xField: time.name,
        yField: num.name,
        colorField: groupCol?.name ?? null,
      });
    }
  }

  // --- PIE / DONUT: one nominal, count or sum of numeric ---
  for (const nom of nomCols.slice(0, 4)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 15) continue;
    const num = numCols[0];
    recs.push({
      id: `pie-${nom.name}-${num?.name ?? "count"}`,
      kind: "pie",
      title: num ? `${num.name} by ${nom.name}` : `Count by ${nom.name}`,
      subtitle: num ? `sum of ${num.name}` : "distribution",
      score: 58,
      spec: {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        mark: { type: "arc", innerRadius: 40 },
        encoding: {
          theta: num
            ? { field: num.name, type: "quantitative", aggregate: "sum" }
            : { aggregate: "count", type: "quantitative" },
          color: { field: nom.name, type: "nominal", scale: { range: COLORS } },
        },
        width: "container", height: "container",
        config: baseConfig(),
      },
      xField: nom.name,
      yField: num?.name ?? null,
      colorField: nom.name,
    });
  }

  // --- HEATMAP: more combos (not just first two nominals) ---
  for (let i = 0; i < Math.min(nomCols.length, 3); i++) {
    for (let j = i + 1; j < Math.min(nomCols.length, 4); j++) {
      const a = nomCols[i];
      const b = nomCols[j];
      if (a.distinct_count <= 20 && b.distinct_count <= 20 && a.distinct_count >= 2 && b.distinct_count >= 2) {
        recs.push({
          id: `heatmap-${a.name}-${b.name}`,
          kind: "heatmap",
          title: `${a.name} × ${b.name}`,
          subtitle: "count heatmap",
          score: 65,
          spec: {
            $schema: "https://vega.github.io/schema/vega-lite/v5.json",
            mark: "rect",
            encoding: {
              x: { field: a.name, type: "nominal" },
              y: { field: b.name, type: "nominal" },
              color: { aggregate: "count", type: "quantitative", scale: { scheme: "purples" } },
            },
            width: "container", height: "container",
            config: baseConfig(),
          },
          xField: a.name,
          yField: b.name,
          colorField: null,
        });
      }
    }
  }

  // --- BUBBLE: three numeric columns (x, y, size) ---
  for (let i = 0; i < numCols.length && i < 3; i++) {
    for (let j = i + 1; j < numCols.length && j < 4; j++) {
      for (let k = 0; k < numCols.length && k < 5; k++) {
        if (k === i || k === j) continue;
        const colorCol = nomCols.length > 0 && nomCols[0].distinct_count <= 15 ? nomCols[0] : null;
        recs.push({
          id: `bubble-${numCols[i].name}-${numCols[j].name}-${numCols[k].name}`,
          kind: "bubble",
          title: `${numCols[i].name} vs ${numCols[j].name} sized by ${numCols[k].name}`,
          subtitle: colorCol
            ? `colored by ${colorCol.name}`
            : (dense ? "three-variable · prefer Clarity or density heatmap when crowded" : "three-variable view"),
          score: veryDense ? 42 : dense ? 55 : 73,
          spec: {},
          xField: numCols[i].name,
          yField: numCols[j].name,
          colorField: colorCol?.name ?? null,
          sizeField: numCols[k].name,
        });
        if (recs.filter(r => r.kind === "bubble").length >= 3) break;
      }
      if (recs.filter(r => r.kind === "bubble").length >= 3) break;
    }
    if (recs.filter(r => r.kind === "bubble").length >= 3) break;
  }

  // --- VIOLIN: nominal × numeric (distribution shape per group) ---
  for (const nom of nomCols.slice(0, 3)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 12) continue;
    for (const num of numCols.slice(0, 3)) {
      recs.push({
        id: `violin-${nom.name}-${num.name}`,
        kind: "violin",
        title: `${num.name} distribution by ${nom.name}`,
        subtitle: "violin — density shape per group",
        score: 66,
        spec: {},
        xField: nom.name,
        yField: num.name,
        colorField: null,
      });
    }
  }

  // --- RADAR: 3+ numeric columns, optionally grouped by a nominal ---
  if (numCols.length >= 3) {
    const axes = numCols.slice(0, 6);
    const groupCol = nomCols.length > 0 && nomCols[0].distinct_count >= 2 && nomCols[0].distinct_count <= 8 ? nomCols[0] : null;
    recs.push({
      id: `radar-${axes.map(c => c.name).join("-")}`,
      kind: "radar",
      title: `Radar: ${axes.map(c => c.name).join(", ")}`,
      subtitle: groupCol ? `per ${groupCol.name}` : "multi-axis profile",
      score: 60,
      spec: {},
      xField: axes[0].name,
      yField: axes[1].name,
      colorField: groupCol?.name ?? null,
    });
  }

  // --- WATERFALL: nominal × numeric (sequential gains/losses) ---
  for (const nom of nomCols.slice(0, 3)) {
    if (nom.distinct_count < 3 || nom.distinct_count > 20) continue;
    for (const num of numCols.slice(0, 2)) {
      recs.push({
        id: `waterfall-${nom.name}-${num.name}`,
        kind: "waterfall",
        title: `${num.name} waterfall by ${nom.name}`,
        subtitle: "cumulative gains and losses",
        score: 62,
        spec: {},
        xField: nom.name,
        yField: num.name,
        colorField: null,
      });
    }
  }

  // --- LOLLIPOP: nominal × numeric (cleaner ranked bar) ---
  for (const nom of nomCols.slice(0, 4)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 30) continue;
    for (const num of numCols.slice(0, 3)) {
      recs.push({
        id: `lollipop-${nom.name}-${num.name}`,
        kind: "lollipop",
        title: `${num.name} by ${nom.name}`,
        subtitle: "lollipop — stem + dot",
        score: 61,
        spec: {},
        xField: nom.name,
        yField: num.name,
        colorField: null,
      });
    }
  }

  // --- DUMBBELL: category × two numerics (before → after / range) ---
  if (numCols.length >= 2) {
    for (const nom of nomCols.slice(0, 3)) {
      if (nom.distinct_count < 2 || nom.distinct_count > 24) continue;
      for (let i = 0; i < Math.min(numCols.length, 3); i++) {
        for (let j = i + 1; j < Math.min(numCols.length, 4); j++) {
          recs.push({
            id: `dumbbell-${nom.name}-${numCols[i].name}-${numCols[j].name}`,
            kind: "dumbbell",
            title: `${numCols[i].name} → ${numCols[j].name} by ${nom.name}`,
            subtitle: "dumbbell — start to end",
            score: 67,
            spec: {},
            xField: nom.name,
            yField: numCols[i].name,
            colorField: null,
            sizeField: numCols[j].name,
            yAggregate: "mean",
          });
          if (recs.filter(r => r.kind === "dumbbell").length >= 4) break;
        }
        if (recs.filter(r => r.kind === "dumbbell").length >= 4) break;
      }
      if (recs.filter(r => r.kind === "dumbbell").length >= 4) break;
    }
  }

  // --- RIDGELINE: numeric density stacked by category ---
  for (const nom of nomCols.slice(0, 3)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 10) continue;
    for (const num of numCols.slice(0, 3)) {
      recs.push({
        id: `ridgeline-${num.name}-${nom.name}`,
        kind: "ridgeline",
        title: `${num.name} ridges by ${nom.name}`,
        subtitle: "ridgeline — overlapping densities",
        score: 65,
        spec: {},
        xField: num.name,
        yField: nom.name,
        colorField: null,
      });
    }
  }

  // --- HEXBIN: dense two-numeric density (prefer when crowded) ---
  for (let i = 0; i < numCols.length && i < 3; i++) {
    for (let j = i + 1; j < numCols.length && j < 4; j++) {
      recs.push({
        id: `hexbin-${numCols[i].name}-${numCols[j].name}`,
        kind: "hexbin",
        title: `${numCols[i].name} × ${numCols[j].name}`,
        subtitle: dense ? "hexbin — density for crowded points" : "hexbin — density tiles",
        score: veryDense ? 78 : dense ? 70 : 58,
        spec: {},
        xField: numCols[i].name,
        yField: numCols[j].name,
        colorField: null,
      });
      if (recs.filter(r => r.kind === "hexbin").length >= 3) break;
    }
    if (recs.filter(r => r.kind === "hexbin").length >= 3) break;
  }

  // --- FUNNEL: ordered stages (category × value) ---
  for (const nom of nomCols.slice(0, 3)) {
    if (nom.distinct_count < 3 || nom.distinct_count > 12) continue;
    for (const num of numCols.slice(0, 2)) {
      recs.push({
        id: `funnel-${nom.name}-${num.name}`,
        kind: "funnel",
        title: `${num.name} funnel by ${nom.name}`,
        subtitle: "funnel — stage conversion",
        score: 64,
        spec: {},
        xField: nom.name,
        yField: num.name,
        colorField: null,
      });
    }
  }

  // --- PARALLEL: 3+ numeric axes ---
  if (numCols.length >= 3) {
    const axes = numCols.slice(0, 6);
    const groupCol = nomCols.find(c => c.distinct_count >= 2 && c.distinct_count <= 10) ?? null;
    recs.push({
      id: `parallel-${axes.map(c => c.name).join("-")}`,
      kind: "parallel",
      title: `Parallel: ${axes.map(c => c.name).join(", ")}`,
      subtitle: groupCol ? `profiles by ${groupCol.name}` : "parallel coordinates",
      score: 61,
      spec: {},
      xField: axes[0].name,
      yField: axes[1].name,
      colorField: groupCol?.name ?? null,
    });
  }

  // --- TREEMAP: nominal × numeric (part-of-whole rectangles) ---
  for (const nom of nomCols.slice(0, 3)) {
    if (nom.distinct_count < 3 || nom.distinct_count > 30) continue;
    for (const num of numCols.slice(0, 2)) {
      const colorCol = nomCols.find(c => c.name !== nom.name && c.distinct_count >= 2 && c.distinct_count <= 10) ?? null;
      recs.push({
        id: `treemap-${nom.name}-${num.name}`,
        kind: "treemap",
        title: `${num.name} by ${nom.name}`,
        subtitle: colorCol ? `nested by ${colorCol.name}` : "treemap",
        score: 64,
        spec: {},
        xField: nom.name,
        yField: num.name,
        colorField: colorCol?.name ?? null,
      });
    }
  }

  // --- SUNBURST: nominal × numeric (radial hierarchy) ---
  for (const nom of nomCols.slice(0, 3)) {
    if (nom.distinct_count < 3 || nom.distinct_count > 20) continue;
    const innerCol = nomCols.find(c => c.name !== nom.name && c.distinct_count >= 2 && c.distinct_count <= 8) ?? null;
    for (const num of numCols.slice(0, 2)) {
      recs.push({
        id: `sunburst-${nom.name}-${num.name}`,
        kind: "sunburst",
        title: `${num.name} by ${nom.name}`,
        subtitle: innerCol ? `inner: ${innerCol.name}` : "sunburst",
        score: 58,
        spec: {},
        xField: nom.name,
        yField: num.name,
        colorField: innerCol?.name ?? null,
      });
    }
  }

  // --- CHOROPLETH: region-like columns × numeric (real polygon map) ---
  const geoCol = nomCols.find(c => isGeoRegionField(c.name) && c.distinct_count >= 3);
  if (geoCol) {
    for (const num of numCols.slice(0, 2)) {
      recs.push({
        id: `choropleth-${geoCol.name}-${num.name}`,
        kind: "choropleth",
        title: `${num.name} by ${geoCol.name}`,
        subtitle: `filled map — ${geoCol.name}`,
        score: 78,
        spec: {},
        xField: geoCol.name,
        yField: num.name,
        colorField: null,
      });
    }
  }

  // --- FORCE BUBBLE: nominal × numeric (packed circles) ---
  for (const nom of nomCols.slice(0, 3)) {
    if (nom.distinct_count < 3 || nom.distinct_count > 40) continue;
    for (const num of numCols.slice(0, 2)) {
      const colorCol = nomCols.find(c => c.name !== nom.name && c.distinct_count >= 2 && c.distinct_count <= 12) ?? null;
      recs.push({
        id: `forceBubble-${nom.name}-${num.name}`,
        kind: "forceBubble",
        title: `${num.name} by ${nom.name}`,
        subtitle: "packed circles",
        score: 63,
        spec: {},
        xField: nom.name,
        yField: num.name,
        colorField: colorCol?.name ?? null,
      });
    }
  }

  // --- SANKEY: two nominals (flow from A → B, count or sum) ---
  for (let i = 0; i < nomCols.length && i < 3; i++) {
    for (let j = i + 1; j < nomCols.length && j < 4; j++) {
      const a = nomCols[i], b = nomCols[j];
      if (a.distinct_count < 2 || a.distinct_count > 20 || b.distinct_count < 2 || b.distinct_count > 20) continue;
      recs.push({
        id: `sankey-${a.name}-${b.name}`,
        kind: "sankey",
        title: `${a.name} → ${b.name}`,
        subtitle: "flow between categories",
        score: 59,
        spec: {},
        xField: a.name,
        yField: numCols.length > 0 ? numCols[0].name : null,
        colorField: b.name,
      });
    }
  }

  // Sort by score (with local viz preference boost), then diversify so Suggest / rail aren't 20 near-identical bars
  // Sprinkle creative odd charts when the schema can support them
  const oddKindsShuffle = [...ODD_CHART_KIND_OPTIONS.map((o) => o.value)].sort(() => Math.random() - 0.5);
  for (const ok of oddKindsShuffle.slice(0, 8)) {
    if (!oddChartDataSupport(columns, ok).ok) continue;
    const enc = getOddRandomEncoding(columns, ok);
    if (!enc) continue;
    const rec = buildOddChartRec(ok, columns, enc.xField, enc.yField, enc.colorField, name, {
      sizeField: enc.sizeField,
    });
    if (rec) {
      rec.score = 58 + Math.floor(Math.random() * 12);
      recs.push(rec);
    }
  }

  // Three usable dimensions → offer the rows × columns × depth data cube
  const cubeRec = suggestDataCubeRec(columns, 66 + Math.floor(Math.random() * 10));
  if (cubeRec) recs.push(cubeRec);

  // Sprinkle geography charts (maps / globe) when lat/lon columns exist
  const hasLonLat =
    columns.some((c) => /^(lat|latitude)$/i.test(c.name)) &&
    columns.some((c) => /^(lon|lng|long|longitude)$/i.test(c.name));
  if (hasLonLat) {
    const geoKindsShuffle = [...GEO_MAP_KIND_OPTIONS.map((o) => o.value)].sort(() => Math.random() - 0.5);
    let geoAdded = 0;
    for (const gk of geoKindsShuffle) {
      if (geoAdded >= 4) break;
      if (!geoMapDataSupport(columns, gk).ok) continue;
      const enc = getGeoMapRandomEncoding(columns, gk);
      if (!enc) continue;
      const rec = buildGeoMapRec(gk, columns, enc.xField, enc.yField, enc.colorField, {
        sizeField: enc.sizeField,
        score: 76 + Math.floor(Math.random() * 12),
      });
      if (rec) {
        recs.push(rec);
        geoAdded += 1;
      }
    }
  }

  const model = prefs !== undefined ? prefs : getCachedVizPreferences();
  const boosted = applyPreferenceBoosts(recs, model, columns);
  return diversifyRecommendations(boosted, 40);
}

export interface StorySequence {
  title: string;
  charts: ChartRecommendation[];
}

/**
 * Returns an ordered sequence of 3–5 charts that "tell a story" about the data:
 * trend → breakdown → distribution → relationship (no AI). Used for "Create story dashboard".
 */
export function recommendStorySequence(
  columns: ColumnInfo[],
  data: QueryResult | null,
  fileName: string,
): StorySequence {
  const all = recommend(columns, data, fileName);
  const baseName = fileName.replace(/\.[^.]+$/, "").replace(/_/g, " ") || "Data";
  const title = `Story: ${baseName}`;

  if (all.length === 0) {
    return { title, charts: [] };
  }

  const byKind = new Map<ChartKind, ChartRecommendation[]>();
  for (const r of all) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    byKind.get(r.kind)!.push(r);
  }

  const pick = (kind: ChartKind): ChartRecommendation | null => {
    const list = byKind.get(kind);
    if (!list?.length) return null;
    return list.shift() ?? null;
  };

  const sequence: ChartRecommendation[] = [];
  const used = new Set<string>();

  // 1. Trend (line or area) — "what happened over time"
  const lineOrArea = pick("line") ?? pick("area");
  if (lineOrArea && !used.has(lineOrArea.id)) {
    sequence.push(lineOrArea);
    used.add(lineOrArea.id);
  }

  // 2. Breakdown (bar or pie) — "by category"
  const barOrPie = pick("bar") ?? pick("pie");
  if (barOrPie && !used.has(barOrPie.id)) {
    sequence.push(barOrPie);
    used.add(barOrPie.id);
  }

  // 3. Distribution (histogram)
  const hist = pick("histogram");
  if (hist && !used.has(hist.id)) {
    sequence.push(hist);
    used.add(hist.id);
  }

  // 4. Relationship (scatter) or map when lat/lon / regions dominate
  const scatter = pick("scatter");
  if (scatter && !used.has(scatter.id)) {
    sequence.push(scatter);
    used.add(scatter.id);
  }

  // 4b. Geography when the schema supports it
  const geoStory =
    pick("choropleth") ??
    pick("geoPoints") ??
    pick("geoBubbles") ??
    pick("globe") ??
    pick("geoHex") ??
    pick("globeTrail") ??
    pick("arcMap");
  if (geoStory && !used.has(geoStory.id)) {
    sequence.push(geoStory);
    used.add(geoStory.id);
  }

  // 5. Fill to 3–5 with next best variety (avoid duplicate kind)
  const remaining = all.filter((r) => !used.has(r.id));
  const kindUsed = new Set(sequence.map((r) => r.kind));
  for (const r of remaining) {
    if (sequence.length >= 5) break;
    if (kindUsed.has(r.kind)) continue;
    sequence.push(r);
    used.add(r.id);
    kindUsed.add(r.kind);
  }
  for (const r of remaining) {
    if (sequence.length >= 5) break;
    if (used.has(r.id)) continue;
    sequence.push(r);
    used.add(r.id);
  }

  return { title, charts: sequence.slice(0, 5) };
}

/** Picks the single best recommendation (highest score). Use for "Suggest chart". */
export function getBestSuggestion(recs: ChartRecommendation[]): ChartRecommendation | null {
  if (recs.length === 0) return null;
  return diversifyRecommendations(recs, 1)[0] ?? null;
}

/**
 * Top suggestions for Suggest chart cycling — high score + kind/encoding variety.
 * Clicking Suggest repeatedly walks this list.
 */
export function getTopSuggestions(
  recs: ChartRecommendation[],
  limit = 6,
): ChartRecommendation[] {
  if (recs.length === 0) return [];
  // Soften per-kind cap for the short Suggest cycle so we get ~6 distinct stories
  const sorted = [...recs].sort((a, b) => b.score - a.score);
  const out: ChartRecommendation[] = [];
  const kindCount = new Map<ChartKind, number>();
  for (const r of sorted) {
    if (out.length >= limit) break;
    const kc = kindCount.get(r.kind) ?? 0;
    if (kc >= 2) continue;
    out.push(r);
    kindCount.set(r.kind, kc + 1);
  }
  for (const r of sorted) {
    if (out.length >= limit) break;
    if (out.some((o) => o.id === r.id)) continue;
    out.push(r);
  }
  return out;
}

export type EncodingShuffleLocks = {
  kind?: boolean;
  x?: boolean;
  y?: boolean;
  color?: boolean;
  size?: boolean;
};

export type RandomEncoding = {
  xField: string;
  yField: string | null;
  colorField: string | null;
  sizeField?: string | null;
};

/** Apply channel locks: keep pinned fields, fill the rest from a fresh random draw. */
export function applyEncodingLocks(
  drawn: RandomEncoding,
  locks: EncodingShuffleLocks | undefined,
  keep: Partial<RandomEncoding> | undefined,
): RandomEncoding {
  if (!locks || !keep) return drawn;
  return {
    xField: locks.x && keep.xField != null ? keep.xField : drawn.xField,
    yField: locks.y ? (keep.yField ?? null) : drawn.yField,
    colorField: locks.color ? (keep.colorField ?? null) : drawn.colorField,
    sizeField: locks.size ? (keep.sizeField ?? null) : drawn.sizeField,
  };
}

/** Pick a random valid encoding for the given chart kind. Returns null if no valid combo.
 *  Often includes a colorField when nominal columns exist (scatter/bar/line/bubble/…). */
export function getRandomEncoding(
  columns: ColumnInfo[],
  kind: ChartKind,
): RandomEncoding | null {
  const numCols = columns.filter(c => inferType(c.data_type, c.name) === "quantitative");
  const nomCols = columns.filter(c => inferType(c.data_type, c.name) === "nominal");
  const timeCols = columns.filter(c => inferType(c.data_type, c.name) === "temporal");
  const pick = <T>(arr: T[]): T | undefined => arr[Math.floor(Math.random() * arr.length)];

  switch (kind) {
    case "scatter": {
      if (numCols.length < 2) return null;
      const x = pick(numCols)!;
      const y = pick(numCols.filter(c => c.name !== x.name)) ?? pick(numCols)!;
      if (x.name === y.name) return null;
      const color = nomCols.length > 0 && nomCols.some(c => c.distinct_count <= 20) ? pick(nomCols.filter(c => c.distinct_count <= 20)) ?? null : null;
      const sizeCol = numCols.length >= 3 && Math.random() > 0.5 ? pick(numCols.filter(c => c.name !== x.name && c.name !== y.name)) ?? null : null;
      return { xField: x.name, yField: y.name, colorField: color?.name ?? null, sizeField: sizeCol?.name ?? null };
    }
    case "bar": {
      const xBar = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 50));
      if (!xBar) return null;
      const yBar = numCols.length > 0 && Math.random() > 0.3 ? pick(numCols)! : null;
      const colorBar = nomCols.length > 0 && nomCols.some(c => c.name !== xBar.name) ? pick(nomCols.filter(c => c.name !== xBar.name)) ?? null : null;
      return { xField: xBar.name, yField: yBar?.name ?? null, colorField: colorBar?.name ?? null };
    }
    case "histogram": {
      const xHist = pick(numCols);
      if (!xHist) return null;
      return { xField: xHist.name, yField: null, colorField: null };
    }
    case "line":
    case "area": {
      const xTime = pick(timeCols.length > 0 ? timeCols : nomCols);
      if (!xTime) return null;
      // Prefer a numeric Y; count-only series still render when yField is null.
      const yVal = numCols.length > 0 ? pick(numCols)! : null;
      const colorLine = nomCols.length > 0 && nomCols.some(c => c.distinct_count <= 15) ? pick(nomCols.filter(c => c.distinct_count <= 15 && c.name !== xTime.name)) ?? null : null;
      return { xField: xTime.name, yField: yVal?.name ?? null, colorField: colorLine?.name ?? null };
    }
    case "heatmap": {
      if (numCols.length >= 2 && Math.random() > 0.4) {
        const a = pick(numCols)!;
        const b = pick(numCols.filter((c) => c.name !== a.name)) ?? numCols.find((c) => c.name !== a.name);
        if (a && b) return { xField: a.name, yField: b.name, colorField: null };
      }
      const a = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 20));
      const b = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 20 && c.name !== a?.name));
      if (!a || !b) return null;
      return { xField: a.name, yField: b.name, colorField: null };
    }
    case "strip": {
      const xStrip = pick(numCols);
      const yStrip = pick(nomCols);
      if (!xStrip || !yStrip) return null;
      const colorStrip = nomCols.length > 0 && Math.random() > 0.4 ? pick(nomCols.filter(c => c.distinct_count <= 15)) ?? null : null;
      return { xField: xStrip.name, yField: yStrip.name, colorField: colorStrip?.name ?? null };
    }
    case "box": {
      const xBox = pick(nomCols.filter(c => c.distinct_count >= 2));
      const yBox = pick(numCols);
      if (!xBox || !yBox) return null;
      return { xField: xBox.name, yField: yBox.name, colorField: null };
    }
    case "pie": {
      const xPie = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 15));
      if (!xPie) return null;
      const yPie = numCols.length > 0 && Math.random() > 0.4 ? pick(numCols)! : null;
      return { xField: xPie.name, yField: yPie?.name ?? null, colorField: null };
    }
    case "bubble": {
      if (numCols.length < 2) return null;
      const shuffled = [...numCols].sort(() => Math.random() - 0.5);
      const color = nomCols.length > 0 && nomCols.some(c => c.distinct_count <= 15) ? pick(nomCols.filter(c => c.distinct_count <= 15)) ?? null : null;
      return {
        xField: shuffled[0]!.name,
        yField: shuffled[1]!.name,
        colorField: color?.name ?? null,
        sizeField: shuffled[2]?.name ?? null,
      };
    }
    case "violin": {
      const xViolin = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 12));
      const yViolin = pick(numCols);
      if (!xViolin || !yViolin) return null;
      const colorViolin = nomCols.length > 1 && Math.random() > 0.5 ? pick(nomCols.filter(c => c.name !== xViolin.name && c.distinct_count <= 8)) ?? null : null;
      return { xField: xViolin.name, yField: yViolin.name, colorField: colorViolin?.name ?? null };
    }
    case "radar": {
      if (numCols.length < 3) return null;
      const x = pick(numCols)!;
      const y = pick(numCols.filter(c => c.name !== x.name));
      const color = nomCols.length > 0 && nomCols.some(c => c.distinct_count >= 2 && c.distinct_count <= 8) ? pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 8)) ?? null : null;
      return { xField: x.name, yField: y?.name ?? null, colorField: color?.name ?? null };
    }
    case "waterfall": {
      const xWf = pick(nomCols.filter(c => c.distinct_count >= 3 && c.distinct_count <= 20));
      if (!xWf) return null;
      const yWf = numCols.length > 0 ? pick(numCols)! : null;
      return { xField: xWf.name, yField: yWf?.name ?? null, colorField: null };
    }
    case "lollipop": {
      const xLol = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 30));
      if (!xLol) return null;
      const yLol = numCols.length > 0 ? pick(numCols)! : null;
      const colorLol = nomCols.length > 1 && Math.random() > 0.6 ? pick(nomCols.filter(c => c.name !== xLol.name && c.distinct_count <= 10)) ?? null : null;
      return { xField: xLol.name, yField: yLol?.name ?? null, colorField: colorLol?.name ?? null };
    }
    case "dumbbell": {
      if (numCols.length < 2) return null;
      const xDb = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 24));
      if (!xDb) return null;
      const shuffled = [...numCols].sort(() => Math.random() - 0.5);
      const colorDb = nomCols.length > 1 && Math.random() > 0.6
        ? pick(nomCols.filter(c => c.name !== xDb.name && c.distinct_count <= 8)) ?? null
        : null;
      return {
        xField: xDb.name,
        yField: shuffled[0]!.name,
        colorField: colorDb?.name ?? null,
        sizeField: shuffled[1]!.name,
      };
    }
    case "ridgeline": {
      const yRidge = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 10));
      const xRidge = pick(numCols);
      if (!xRidge || !yRidge) return null;
      return { xField: xRidge.name, yField: yRidge.name, colorField: null };
    }
    case "hexbin": {
      if (numCols.length < 2) return null;
      const a = pick(numCols)!;
      const b = pick(numCols.filter(c => c.name !== a.name)) ?? numCols.find(c => c.name !== a.name);
      if (!b) return null;
      return { xField: a.name, yField: b.name, colorField: null };
    }
    case "funnel": {
      const xFun = pick(nomCols.filter(c => c.distinct_count >= 3 && c.distinct_count <= 12));
      if (!xFun) return null;
      const yFun = numCols.length > 0 ? pick(numCols)! : null;
      return { xField: xFun.name, yField: yFun?.name ?? null, colorField: null };
    }
    case "parallel": {
      if (numCols.length < 3) return null;
      const x = pick(numCols)!;
      const y = pick(numCols.filter(c => c.name !== x.name));
      const color = nomCols.find(c => c.distinct_count >= 2 && c.distinct_count <= 10) ?? null;
      return { xField: x.name, yField: y?.name ?? null, colorField: color?.name ?? null };
    }
    case "treemap": {
      const xTree = pick(nomCols.filter(c => c.distinct_count >= 3 && c.distinct_count <= 30));
      if (!xTree) return null;
      const yTree = numCols.length > 0 ? pick(numCols)! : null;
      const colorTree = nomCols.length > 1 ? pick(nomCols.filter(c => c.name !== xTree.name && c.distinct_count <= 10)) ?? null : null;
      return { xField: xTree.name, yField: yTree?.name ?? null, colorField: colorTree?.name ?? null };
    }
    case "sunburst": {
      const xSun = pick(nomCols.filter(c => c.distinct_count >= 3 && c.distinct_count <= 20));
      if (!xSun) return null;
      const ySun = numCols.length > 0 ? pick(numCols)! : null;
      const innerSun = nomCols.length > 1 ? pick(nomCols.filter(c => c.name !== xSun.name && c.distinct_count <= 8)) ?? null : null;
      return { xField: xSun.name, yField: ySun?.name ?? null, colorField: innerSun?.name ?? null };
    }
    case "choropleth": {
      const geoCols = nomCols.filter(c => isGeoRegionField(c.name) && c.distinct_count >= 3);
      const geoCol = geoCols.length > 0 ? pick(geoCols)! : pick(nomCols.filter(c => c.distinct_count >= 3));
      if (!geoCol) return null;
      const yGeo = numCols.length > 0 ? pick(numCols)! : null;
      return { xField: geoCol.name, yField: yGeo?.name ?? null, colorField: null };
    }
    case "forceBubble": {
      const xForce = pick(nomCols.filter(c => c.distinct_count >= 3 && c.distinct_count <= 40));
      if (!xForce) return null;
      const yForce = numCols.length > 0 ? pick(numCols)! : null;
      const colorForce = nomCols.length > 1 ? pick(nomCols.filter(c => c.name !== xForce.name && c.distinct_count <= 12)) ?? null : null;
      return { xField: xForce.name, yField: yForce?.name ?? null, colorField: colorForce?.name ?? null };
    }
    case "sankey": {
      if (nomCols.length < 2) return null;
      const sankeyNom = nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 20);
      const a = pick(sankeyNom);
      if (!a) return null;
      const b = pick(sankeyNom.filter(c => c.name !== a.name));
      if (!b) return null;
      const yVal = numCols.length > 0 && Math.random() > 0.3 ? pick(numCols)! : null;
      return { xField: a.name, yField: yVal?.name ?? null, colorField: b.name };
    }
    default:
      if (isGpuSceneKind(kind)) return getGpuRandomEncoding(columns, kind);
      if (isGeoMapKind(kind)) return getGeoMapRandomEncoding(columns, kind);
      if (isOddChartKind(kind)) return getOddRandomEncoding(columns, kind);
      return null;
  }
}

const ALL_CHART_KINDS: ChartKind[] = CHART_KIND_OPTIONS.map(o => o.value);

/** Whether the schema can ever satisfy this chart type (deterministic; for UI disabling). */
export function chartKindDataSupport(columns: ColumnInfo[], kind: ChartKind): { ok: boolean; reason: string } {
  const numCols = columns.filter(c => inferType(c.data_type, c.name) === "quantitative");
  const nomCols = columns.filter(c => inferType(c.data_type, c.name) === "nominal");
  const timeCols = columns.filter(c => inferType(c.data_type, c.name) === "temporal");
  const nom = (min: number, max: number) => nomCols.filter(c => c.distinct_count >= min && c.distinct_count <= max);

  switch (kind) {
    case "scatter":
      return numCols.length >= 2 ? { ok: true, reason: "" } : { ok: false, reason: "Need ≥2 numeric columns" };
    case "bubble":
      return numCols.length >= 2 ? { ok: true, reason: "" } : { ok: false, reason: "Need ≥2 numeric columns" };
    case "histogram":
      return numCols.length >= 1 ? { ok: true, reason: "" } : { ok: false, reason: "Need a numeric column" };
    case "bar":
    case "lollipop":
      return nom(2, kind === "lollipop" ? 30 : 50).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (2–" + (kind === "lollipop" ? "30" : "50") + " distinct values)" };
    case "dumbbell":
      return nom(2, 24).length >= 1 && numCols.length >= 2
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (2–24) + two numeric columns" };
    case "ridgeline":
      return nomCols.some(c => c.distinct_count >= 2 && c.distinct_count <= 10) && numCols.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need category (2–10 groups) + numeric" };
    case "hexbin":
      return numCols.length >= 2
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need ≥2 numeric columns" };
    case "funnel":
      return nom(3, 12).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (3–12 stages)" };
    case "parallel":
      return numCols.length >= 3
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need ≥3 numeric columns" };
    case "line":
    case "area":
      return (timeCols.length > 0 || nomCols.length > 0)
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a date/time or text column for X" };
    case "pie":
      return nom(2, 15).length >= 1 ? { ok: true, reason: "" } : { ok: false, reason: "Need a category (2–15 distinct)" };
    case "heatmap":
      return numCols.length >= 2 || nom(2, 20).length >= 2
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need two numeric columns (density) or two categories (2–20 distinct)" };
    case "strip":
      return numCols.length >= 1 && nomCols.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need one numeric + one category" };
    case "box":
      return nomCols.some(c => c.distinct_count >= 2) && numCols.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need category + numeric" };
    case "violin":
      return nomCols.some(c => c.distinct_count >= 2 && c.distinct_count <= 12) && numCols.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need category (2–12 groups) + numeric" };
    case "radar":
      return numCols.length >= 3 ? { ok: true, reason: "" } : { ok: false, reason: "Need ≥3 numeric columns" };
    case "waterfall":
      return nom(3, 20).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (3–20 distinct values)" };
    case "treemap":
      return nom(3, 30).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (3–30 distinct values)" };
    case "sunburst":
      return nom(3, 20).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (3–20 distinct values)" };
    case "forceBubble":
      return nom(3, 40).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (3–40 distinct values)" };
    case "choropleth": {
      // A filled map needs countries / states — any other category matches nothing
      const geo = nomCols.filter(c => isGeoRegionField(c.name) && c.distinct_count >= 3);
      return geo.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a country or state column" };
    }
    case "sankey":
      return nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 20).length >= 2
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need two categories (2–20 distinct each)" };
    default:
      if (isGpuSceneKind(kind)) return gpuSceneDataSupport(columns, kind);
      if (isGeoMapKind(kind)) return geoMapDataSupport(columns, kind);
      if (isOddChartKind(kind)) return oddChartDataSupport(columns, kind);
      return { ok: true, reason: "" };
  }
}

/**
 * Random chart that passes createChartRec + schema support. Retries encodings;
 * falls back to top recommend() result. Optional locks keep kind / channels.
 */
export function tryBuildRandomChartRec(
  columns: ColumnInfo[],
  tableName: string,
  opts?: {
    locks?: EncodingShuffleLocks;
    keep?: Partial<RandomEncoding> & { kind?: ChartKind };
  },
): ChartRecommendation | null {
  if (columns.length === 0) return null;
  const locks = opts?.locks ?? {};
  const keep = opts?.keep;
  const supported = ALL_CHART_KINDS.filter((k) => chartKindDataSupport(columns, k).ok);
  let pool = supported.length > 0 ? supported : ALL_CHART_KINDS;
  if (locks.kind && keep?.kind && pool.includes(keep.kind)) {
    pool = [keep.kind];
  }
  for (let round = 0; round < 4; round++) {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    for (const kind of shuffled) {
      for (let att = 0; att < 14; att++) {
        const drawn = getRandomEncoding(columns, kind);
        if (!drawn) break;
        const enc = applyEncodingLocks(drawn, locks, keep);
        const extra: Parameters<typeof createChartRec>[6] = {};
        if (enc.sizeField) extra.sizeField = enc.sizeField;
        const rec = createChartRec(kind, columns, enc.xField, enc.yField, enc.colorField, tableName, extra);
        if (rec) return rec;
      }
    }
  }
  const recs = recommend(columns, null, tableName);
  return recs[0] ?? null;
}

/** Pick a random chart kind and valid encoding. */
export function getRandomChartAndEncoding(
  columns: ColumnInfo[],
  tableName = "data",
): { kind: ChartKind; xField: string; yField: string | null; colorField: string | null; sizeField?: string | null } | null {
  const rec = tryBuildRandomChartRec(columns, tableName);
  if (!rec) return null;
  return {
    kind: rec.kind,
    xField: rec.xField,
    yField: rec.yField,
    colorField: rec.colorField,
    sizeField: rec.sizeField ?? undefined,
  };
}

/** Short, human-readable reason why this chart type fits the data. No LLM required. */
export function getRecommendationReason(rec: ChartRecommendation): string {
  const { kind, xField, yField, colorField } = rec;
  switch (kind) {
    case "scatter":
      return yField ? "Two numeric columns → good for correlation or distribution" : "Numeric pairs for relationship";
    case "line":
      return "Time or sequence on X, value on Y → trend over time";
    case "bar":
      return colorField
        ? "Category + subcategory on Color → dodged, stacked, or 100% bars"
        : yField
          ? "Category vs value (sum/mean/count) → compare groups"
          : "Count by category";
    case "histogram":
      return "Single numeric column → distribution of values";
    case "area":
      return "Stacked or single series over X → cumulative or trend";
    case "pie":
      return "Part-to-whole by category";
    case "heatmap":
      return "Two categories + count → density or contingency";
    case "strip":
      return "One numeric, optional category → spread across axis";
    case "box":
      return "Distribution by category → quartiles and outliers";
    case "bubble":
      return "Three numeric columns → position + size encodes a third variable";
    case "violin":
      return "Numeric per category → full distribution shape, not just quartiles";
    case "radar":
      return "Multiple numeric axes → compare profiles across categories";
    case "waterfall":
      return "Sequential categories → show cumulative gains and losses";
    case "lollipop":
      return "Category vs value → clean stem+dot, easier to read than bars";
    case "dumbbell":
      return "Two measures per category → before/after or range comparison";
    case "ridgeline":
      return "Numeric density stacked by group → compare shapes without overlap clutter";
    case "hexbin":
      return "Two numerics when points pile up → hexagonal density instead of overplot";
    case "funnel":
      return "Ordered stages → conversion or attrition through a pipeline";
    case "parallel":
      return "Three or more numerics → multi-axis profiles across rows or groups";
    case "treemap":
      return "Nested rectangles → part-of-whole with optional hierarchy";
    case "sunburst":
      return "Radial slices → hierarchical composition at a glance";
    case "choropleth":
      return "Region codes joined to world/US polygons — real filled map";
    case "forceBubble":
      return "Packed circles → size comparison without axes, grouped by category";
    case "sankey":
      return "Two categories → flow and volume between groups";
    default:
      if (isGpuSceneKind(kind)) return gpuSceneRecommendationReason(kind);
      if (isGeoMapKind(kind)) return geoMapRecommendationReason(kind);
      if (isOddChartKind(kind)) return oddRecommendationReason(kind);
      return "Fits your column types and cardinality";
  }
}

// =================================================================
// Wikipedia Stream — curated chart recommendations
// =================================================================

/**
 * Pre-built dashboard story for Wikipedia stream data.
 * Returns chart recs tailored to the wiki_stream schema.
 */
export function recommendStreamStory(
  columns: ColumnInfo[],
  data: QueryResult | null,
): StorySequence {
  const colNames = new Set(columns.map((c) => c.name));
  const hasTs = colNames.has("ts");
  const hasWiki = colNames.has("wiki");
  const hasBot = colNames.has("bot");
  const hasNamespace = colNames.has("namespace");
  const hasDelta = colNames.has("delta");
  const hasEditType = colNames.has("edit_type");

  const charts: ChartRecommendation[] = [];
  let idx = 0;
  const mkId = () => `stream-${Date.now()}-${idx++}`;

  const mkRec = (
    kind: ChartKind,
    title: string,
    subtitle: string,
    score: number,
    xField: string,
    yField: string | null,
    colorField: string | null,
    yAggregate?: YAggregateOption | null,
  ): ChartRecommendation => ({
    id: mkId(),
    kind,
    title,
    subtitle,
    score,
    spec: {},
    xField,
    yField,
    colorField,
    yAggregate: yAggregate ?? null,
  });

  if (hasTs) {
    charts.push(mkRec("line", "Edits over time", "Event rate trend — the pulse of Wikipedia", 95, "ts", null, null, "count"));
  }
  if (hasWiki) {
    charts.push(mkRec("bar", "Edits by wiki", "Which language editions are most active", 90, "wiki", null, null, "count"));
  }
  if (hasBot && hasWiki) {
    charts.push(mkRec("bar", "Bot vs Human", "Automated edits vs manual contributions", 88, "bot", null, "wiki", "count"));
  }
  if (hasDelta) {
    charts.push(mkRec("histogram", "Edit size distribution", "How big are typical edits (bytes delta)", 85, "delta", null, null));
  }
  if (hasNamespace && hasDelta) {
    charts.push(mkRec("bar", "Impact by namespace", "Average edit size per namespace", 82, "namespace", "delta", null, "mean"));
  }
  if (hasEditType) {
    charts.push(mkRec("pie", "Edit types", "New pages vs edits vs categorize vs log", 80, "edit_type", null, null, "count"));
  }
  if (hasTs && hasWiki) {
    charts.push(mkRec("area", "Activity by wiki over time", "Stacked area of edit volume per wiki", 78, "ts", null, "wiki", "count"));
  }
  if (hasBot && hasTs) {
    charts.push(mkRec("line", "Bot activity trend", "Are bots more active at certain times?", 75, "ts", null, "bot", "count"));
  }

  return {
    title: "Wikipedia Live: Real-time edit analytics",
    charts: charts.slice(0, 6),
  };
}

/**
 * Chart recommendations for poll-based sources (USGS, Open-Meteo, NWS, World Bank).
 */
export function recommendSourceStory(
  kind: string,
  columns: ColumnInfo[],
  data: QueryResult | null,
): StorySequence {
  let idx = 0;
  const mkId = () => `${kind}-${Date.now()}-${idx++}`;
  const mk = (
    k: ChartKind, title: string, subtitle: string, score: number,
    xField: string, yField: string | null, colorField: string | null,
    yAgg?: YAggregateOption | null,
    sizeField?: string | null,
    extraEnc?: { zField?: string | null; timeField?: string | null; trailId?: string | null },
  ): ChartRecommendation => ({
    id: mkId(), kind: k, title, subtitle, score, spec: {},
    xField, yField, colorField, yAggregate: yAgg ?? null,
    sizeField: sizeField ?? undefined,
    zField: extraEnc?.zField ?? undefined,
    timeField: extraEnc?.timeField ?? undefined,
    trailId: extraEnc?.trailId ?? undefined,
  });

  if (kind === "usgs") {
    return {
      title: "Earthquake Analytics",
      charts: [
        mk("geoPoints", "Quake map", "Projected locations on coastlines", 98, "longitude", "latitude", "mag_type", null, "magnitude"),
        mk("geoHex", "Quake hex density", "Where energy piles up on the map", 96, "longitude", "latitude", "mag_type"),
        mk("globe", "Quake globe", "Spin the planet — quakes as points", 95, "longitude", "latitude", "mag_type", null, "magnitude"),
        mk("scatter3d", "Orbit depth cloud", "Lat · lon · depth — drag to orbit", 94, "longitude", "latitude", "mag_type", null, "magnitude", { zField: "depth" }),
        mk("quakeTerrain", "Magnitude terrain", "Heightfield where energy piles up", 92, "longitude", "latitude", "mag_type", null, "magnitude", { zField: "magnitude" }),
        mk("firefly", "Firefly aftershocks", "Soft glow by magnitude", 88, "longitude", "latitude", "mag_type", null, "magnitude", { timeField: "ts" }),
      ].slice(0, 6),
    };
  }

  if (kind === "meteo") {
    return {
      title: "World Weather Comparison",
      charts: [
        mk("geoBubbles", "City climate map", "Twelve cities sized by temperature", 96, "longitude", "latitude", "city", null, "temperature"),
        mk("line", "Temperature over time", "How does temperature vary across cities?", 95, "ts", "temperature", "city"),
        mk("stream", "Temp streams by city", "Organic stacked climate flow", 92, "ts", "temperature", "city"),
        mk("beeswarm", "Temp swarm by city", "Every reading as a dot", 88, "city", "temperature", null),
        mk("horizon", "Horizon temperature", "Folded bands of heat", 86, "ts", "temperature", null),
        mk("radialBar", "City temp wheel", "Polar comparison", 82, "city", "temperature", null, "mean"),
      ].slice(0, 6),
    };
  }

  if (kind === "nws") {
    return {
      title: "US Weather Alert Analytics",
      charts: [
        mk("bar", "Alerts by event type", "What kinds of alerts are most common?", 95, "event", null, null, "count"),
        mk("bar", "Alerts by severity", "Distribution of severity levels", 90, "severity", null, null, "count"),
        mk("pie", "Urgency breakdown", "How urgent are current alerts?", 85, "urgency", null, null, "count"),
        mk("bar", "Top alert sources", "Which NWS offices issue most alerts?", 80, "sender_name", null, null, "count"),
        mk("bar", "Certainty levels", "How certain are the alerts?", 75, "certainty", null, "severity", "count"),
      ].slice(0, 5),
    };
  }

  if (kind === "world_bank") {
    return {
      title: "Global development",
      charts: [
        mk("choropleth", "Life expectancy map", "Average years of life by country", 96, "country_code", "life_expectancy", null, "mean"),
        mk("bubble", "Wealth vs health", "GDP per person against life expectancy, sized by population", 98, "gdp_per_capita", "life_expectancy", null, null, "population"),
        mk("line", "Life expectancy over time", "Average across countries, 2000–2023", 92, "yr", "life_expectancy", null, "mean"),
        mk("bar", "Most populous countries", "Peak population, 2000–2023", 90, "country_name", "population", null, "max"),
        mk("scatter", "CO₂ vs wealth", "Emissions per person against GDP per person", 88, "gdp_per_capita", "co2_per_capita", null),
        mk("choropleth", "GDP per person map", "Highest GDP per person reached", 84, "country_code", "gdp_per_capita", null, "max"),
      ].slice(0, 6),
    };
  }

  if (kind === "iss") {
    return {
      title: "ISS orbital track",
      charts: [
        mk("globeTrail", "Orbit on the globe", "Great-circle path around the sphere", 98, "longitude", "latitude", null, null, "altitude_km", { timeField: "ts" }),
        mk("geoPoints", "Ground track map", "Projected path on coastlines", 96, "longitude", "latitude", null, null, "altitude_km", { timeField: "ts" }),
        mk("trailRibbon", "Orbital ribbons", "Path fades through recent samples", 94, "longitude", "latitude", null, null, "altitude_km", { timeField: "ts" }),
        mk("scatter3d", "Altitude cloud", "Lon · lat · altitude", 90, "longitude", "latitude", null, null, "velocity_kmh", { zField: "altitude_km", timeField: "ts" }),
        mk("line", "Altitude over time", "How high is the station?", 86, "ts", "altitude_km", null),
      ].slice(0, 5),
    };
  }

  if (kind === "hn") {
    return {
      title: "Hacker News front page",
      charts: [
        mk("bar", "Top stories by points", "What's hottest right now?", 95, "title", "points", null, "max"),
        mk("scatter", "Points vs comments", "Discussion intensity", 90, "points", "num_comments", "author"),
        mk("histogram", "Score distribution", "How viral is the front page?", 85, "points", null, null),
        mk("bar", "Active authors", "Who is posting?", 78, "author", null, null, "count"),
      ].slice(0, 5),
    };
  }

  if (kind === "crypto") {
    return {
      title: "Crypto markets",
      charts: [
        mk("bar", "Market cap leaders", "The biggest coins by value", 95, "symbol", "market_cap", null, "max"),
        mk("bar", "24h movers", "Who gained and lost the most today", 92, "symbol", "change_24h_pct", null, "max"),
        mk("treemap", "Market share", "Each coin's slice of the top 50", 90, "symbol", "market_cap", null, "max"),
        mk("beeswarm", "Daily moves", "Every coin's 24h % change as a dot", 85, "symbol", "change_24h_pct", null),
        mk("isoScatter", "Price · change · volume", "Pseudo-3D market space", 80, "price_usd", "change_24h_pct", "symbol", null, "volume_24h"),
      ].slice(0, 5),
    };
  }

  if (kind === "aq") {
    return {
      title: "City air quality",
      charts: [
        mk("geoBubbles", "AQI on the map", "Cities as pollution bubbles", 96, "longitude", "latitude", "city", null, "pm2_5"),
        mk("bar", "PM2.5 by city", "Who is breathing the most fine particulate?", 95, "city", "pm2_5", null, "max"),
        mk("bar", "European AQI", "Compare air quality index across cities", 90, "city", "european_aqi", null, "max"),
        mk("scatter", "PM2.5 vs ozone", "Do pollutants move together?", 85, "pm2_5", "ozone", "city"),
        mk("bar", "NO₂ by city", "Traffic and combustion signal", 80, "city", "nitrogen_dioxide", null, "max"),
      ].slice(0, 5),
    };
  }

  if (kind === "fx") {
    return {
      title: "Euro exchange rates",
      charts: [
        mk("box", "Volatility by currency", "Spread of daily % moves over 90 days", 92, "quote", "change_pct", null),
        mk("line", "Daily moves by currency", "% change vs the euro, day to day", 95, "as_of", "change_pct", "quote", "mean"),
        mk("bar", "Average rate vs EUR", "Units per euro, 90-day average", 85, "quote", "rate", null, "mean"),
        mk("beeswarm", "Every daily move", "Each currency-day as a dot", 80, "quote", "change_pct", null),
      ].slice(0, 5),
    };
  }

  if (kind === "fema") {
    return {
      title: "FEMA disaster declarations",
      charts: [
        mk("choropleth", "Declarations by state", "US states filled by declaration count", 98, "state", null, null, "count"),
        mk("bar", "By incident type", "What kinds of disasters are declared?", 95, "incident_type", null, null, "count"),
        mk("bar", "By state", "Which states see the most declarations?", 90, "state", null, null, "count"),
        mk("bar", "Declaration type", "Major disaster vs emergency", 85, "declaration_type", null, null, "count"),
        mk("histogram", "Fiscal year declared", "When were they declared?", 78, "fy_declared", null, null),
      ].slice(0, 5),
    };
  }

  if (kind === "opensky") {
    return {
      title: "Aircraft over the US",
      charts: [
        mk("geoPoints", "Sky map", "Projected positions on coastlines", 96, "longitude", "latitude", "origin_country", null, "baro_altitude"),
        mk("globeTrail", "Flight globe", "Craft paths wrapped on the sphere", 98, "longitude", "latitude", "origin_country", null, "baro_altitude", { timeField: "ts", trailId: "icao24" }),
        mk("geoBubbles", "Altitude bubbles", "Sized by barometric altitude", 94, "longitude", "latitude", "origin_country", null, "baro_altitude"),
        mk("trailRibbon", "Flight ribbons", "Each craft leaves a fading trail", 92, "longitude", "latitude", "origin_country", null, "baro_altitude", { timeField: "ts", trailId: "icao24" }),
        mk("scatter3d", "Altitude orbit cloud", "Lon · lat · altitude — drag to orbit", 88, "longitude", "latitude", "origin_country", null, "velocity", { zField: "baro_altitude" }),
      ].slice(0, 5),
    };
  }

  if (kind === "countries") {
    return {
      title: "World countries",
      charts: [
        mk("choropleth", "Population map", "Countries filled by population", 98, "cca3", "population", "region", "max"),
        mk("bar", "Population leaders", "Most populous countries", 95, "name", "population", "region", "max"),
        mk("bucketField", "Regions as fields", "Countries as dots in regional paddocks", 90, "region", "population", "region", null, "area"),
        mk("glyphStar", "Country stars", "Multivariate star glyphs", 86, "name", "population", "area", null, "density"),
        mk("isoBars", "Isometric population", "Fake-3D country blocks", 82, "name", "population", "region", "max"),
        mk("waffle", "Region waffle", "Share of countries by region", 78, "region", null, null, "count"),
      ].slice(0, 6),
    };
  }

  if (kind === "spacex") {
    return {
      title: "SpaceX launch history",
      charts: [
        mk("bar", "Launches by rocket", "Which vehicles flew — colored by outcome", 95, "rocket", null, "success", "count"),
        mk("pie", "Success rate", "Share of missions that reached orbit", 90, "success", null, null, "count"),
        mk("strip", "Launch timeline", "Every launch as a tick, by rocket", 85, "date_utc", "rocket", "success"),
      ].slice(0, 5),
    };
  }

  if (kind === "nyc311") {
    return {
      title: "NYC 311 complaints",
      charts: [
        mk("geoPoints", "Complaint map", "Tickets on a projected basemap", 98, "longitude", "latitude", "borough"),
        mk("geoHex", "Complaint density", "Hexbins of 311 heat", 96, "longitude", "latitude", "borough"),
        mk("bar", "Top complaint types", "What are New Yorkers reporting?", 92, "complaint_type", null, null, "count"),
        mk("bar", "By borough", "Where do tickets concentrate?", 86, "borough", null, null, "count"),
        mk("bar", "By agency", "Who responds?", 80, "agency", null, null, "count"),
      ].slice(0, 5),
    };
  }

  if (kind === "covid") {
    return {
      title: "COVID-19 by country",
      charts: [
        mk("choropleth", "Cases world map", "Countries filled by cumulative cases", 98, "country", "cases", "continent", "max"),
        mk("bar", "Cases leaders", "Highest cumulative cases", 95, "country", "cases", "continent", "max"),
        mk("pyramid", "Cases ↔ deaths", "Mirror comparison by country", 90, "country", "cases", null, null, "deaths"),
        mk("slope", "Cases → deaths", "Lean diagonal of severity", 86, "country", "cases_per_million", null, null, "deaths_per_million"),
        mk("mosaic", "Continent × country share", "Joint composition", 82, "continent", "cases", "country", "sum"),
        mk("isotype", "Case units", "Icon stacks of magnitude", 78, "continent", "cases", null, "sum"),
      ].slice(0, 6),
    };
  }

  if (kind === "launches") {
    return {
      title: "Upcoming space launches",
      charts: [
        mk("bar", "By agency", "Who is launching next?", 95, "agency", null, null, "count"),
        mk("bar", "By location", "Which pads are busiest?", 90, "location", null, null, "count"),
        mk("bar", "By rocket", "Vehicles on the schedule", 85, "rocket", null, null, "count"),
        mk("bar", "Status mix", "Go / Hold / TBD", 80, "status", null, null, "count"),
      ].slice(0, 5),
    };
  }

  if (kind === "eonet") {
    return {
      title: "Natural events on Earth",
      charts: [
        mk("geoPoints", "Active events map", "Wildfires, storms, and volcanoes NASA is tracking", 98, "longitude", "latitude", "category"),
        mk("bar", "Events by type", "What is burning, blowing, or erupting right now?", 94, "category", null, null, "count"),
        mk("globe", "Events on the globe", "Spin to see where nature is active", 92, "longitude", "latitude", "category"),
        mk("geoBubbles", "Events by size", "Bubble size from reported magnitude", 88, "longitude", "latitude", "category", null, "magnitude"),
        mk("bar", "Reporting sources", "Who reports these events?", 80, "source", null, null, "count"),
      ].slice(0, 5),
    };
  }

  if (kind === "citibike") {
    return {
      title: "Citi Bike right now",
      charts: [
        mk("geoPoints", "Bikes on the map", "Every dock, sized by bikes available", 98, "longitude", "latitude", null, null, "bikes_available"),
        mk("histogram", "How full are docks?", "Share of each dock filled with bikes", 94, "pct_full", null, null),
        mk("scatter", "Capacity vs bikes", "Big docks running empty or full", 90, "capacity", "bikes_available", null),
        mk("geoHex", "Dock density", "Where Citi Bike stations cluster", 86, "longitude", "latitude", null),
        mk("bar", "Most bikes now", "Docks with the most bikes available", 82, "name", "bikes_available", null, "max"),
      ].slice(0, 5),
    };
  }

  if (kind === "spaceweather") {
    return {
      title: "Geomagnetic activity",
      charts: [
        mk("line", "Kp index this week", "Kp 5+ is a geomagnetic storm — auroras farther from the poles", 98, "ts", "kp", null, "max"),
        mk("bar", "Storm levels", "How many 3-hour periods hit each G level", 90, "storm_level", null, null, "count"),
        mk("area", "Kp over time", "Filled view of geomagnetic activity", 86, "ts", "kp", null, "max"),
      ].slice(0, 5),
    };
  }

  if (kind === "ukcarbon") {
    return {
      title: "Britain's grid carbon",
      charts: [
        mk("line", "Carbon intensity today", "Grams of CO₂ per kWh, every half hour (forecast)", 98, "ts", "forecast", null, "mean"),
        mk("line", "Measured intensity", "Actual readings so far", 92, "ts", "actual", null, "mean"),
        mk("scatter", "Forecast vs actual", "How good is the forecast?", 88, "forecast", "actual", null),
        mk("bar", "Intensity bands", "Half hours by carbon index", 84, "intensity_index", null, null, "count"),
      ].slice(0, 5),
    };
  }

  if (kind === "pageviews") {
    return {
      title: "What the world read yesterday",
      charts: [
        mk("bar", "Most-read articles", "Yesterday's top English Wikipedia pages", 98, "article", "views", null, "max"),
        mk("treemap", "Attention map", "Each article sized by views", 92, "article", "views", null, "max"),
        mk("lollipop", "Top reads", "Views per article", 86, "article", "views", null, "max"),
      ].slice(0, 5),
    };
  }

  if (kind === "climate") {
    return {
      title: "Global warming since 1880",
      charts: [
        mk("line", "Warming by year", "Average land + ocean anomaly vs the 20th-century mean (°C)", 99, "year", "anomaly_c", null, "mean"),
        mk("spiral", "Climate spiral", "Each turn is a year — watch it widen", 95, "ts", "anomaly_c", null),
        mk("line", "Every month since 1880", "Monthly anomaly (°C)", 90, "ts", "anomaly_c", null, "mean"),
        mk("box", "Spread by month", "Which months run warmest?", 82, "month", "anomaly_c", null),
      ].slice(0, 5),
    };
  }

  if (kind === "gdacs") {
    return {
      title: "Disasters underway",
      charts: [
        mk("geoBubbles", "Active disasters", "Sized by expected impact, colored by type", 98, "longitude", "latitude", "event_type", null, "alert_score"),
        mk("bar", "By disaster type", "What is happening most right now?", 94, "event_type", null, "alert_level", "count"),
        mk("bar", "By alert level", "Green / orange / red", 90, "alert_level", null, null, "count"),
        mk("bar", "Countries affected", "Where alerts are concentrated", 84, "country", null, null, "count"),
      ].slice(0, 5),
    };
  }

  if (kind === "buoys") {
    return {
      title: "The ocean right now",
      charts: [
        mk("geoBubbles", "Wave heights at sea", "Every buoy sized by significant wave height", 97, "longitude", "latitude", null, null, "wave_height_m"),
        mk("scatter", "Wind vs waves", "Do stronger winds mean bigger seas?", 92, "wind_speed_ms", "wave_height_m", null),
        mk("geoBubbles", "Sea temperature", "Buoys sized by water temperature", 88, "longitude", "latitude", null, null, "water_temp_c"),
        mk("histogram", "Water temperatures", "Distribution across stations (°C)", 82, "water_temp_c", null, null),
      ].slice(0, 5),
    };
  }

  if (kind === "mbta") {
    return {
      title: "Boston transit, live",
      charts: [
        mk("geoPoints", "Every vehicle now", "Buses, subway, light rail, and commuter rail", 98, "longitude", "latitude", "route_type"),
        mk("bar", "Busiest routes", "Vehicles running per route", 92, "route", null, "route_type", "count"),
        mk("bar", "By mode", "How the fleet splits right now", 88, "route_type", null, null, "count"),
        mk("histogram", "Speeds", "How fast vehicles are moving (mph)", 82, "speed_mph", null, null),
      ].slice(0, 5),
    };
  }

  if (kind === "aurora") {
    return {
      title: "Aurora forecast",
      charts: [
        mk("geoBubbles", "Aurora oval now", "Chance of aurora overhead in the next ~30 minutes", 98, "longitude", "latitude", null, null, "probability"),
        mk("globe", "Aurora on the globe", "Spin to the poles", 92, "longitude", "latitude", null, null, "probability"),
        mk("scatter", "Latitude vs chance", "How far from the poles it reaches", 86, "latitude", "probability", null),
      ].slice(0, 5),
    };
  }

  if (kind === "asteroids") {
    return {
      title: "Asteroids passing Earth",
      charts: [
        mk("bubble", "Close passes", "Distance (lunar distances) vs speed, sized by estimated diameter", 97, "distance_ld", "velocity_kms", null, null, "diameter_m"),
        mk("bar", "Biggest visitors", "Estimated diameter (m)", 92, "name", "diameter_m", null, "max"),
        mk("histogram", "How close?", "Miss distance in lunar distances", 86, "distance_ld", null, null),
        mk("scatter", "Size vs distance", "Big ones pass farther out", 80, "diameter_m", "distance_ld", null),
      ].slice(0, 5),
    };
  }

  if (kind === "steam") {
    return {
      title: "What gamers are playing",
      charts: [
        mk("bar", "Most-played games", "Peak concurrent players yesterday", 97, "name", "peak_players", null, "max"),
        mk("bubble", "Price vs reviews", "Sized by peak players", 92, "price_usd", "positive_pct", null, null, "peak_players"),
        mk("histogram", "Review scores", "Share of positive reviews (%)", 86, "positive_pct", null, null),
        mk("bar", "Top developers", "Games in the top 100", 80, "developer", null, null, "count"),
      ].slice(0, 5),
    };
  }

  if (kind === "bitcoin") {
    return {
      title: "Bitcoin, block by block",
      charts: [
        mk("bar", "Who mined the latest blocks", "Blocks per mining pool", 96, "pool", null, null, "count"),
        mk("line", "Transactions per block", "Over the latest ~60 blocks", 93, "ts", "tx_count", null, "max"),
        mk("line", "Median fee", "sat/vB paid to get into each block", 90, "ts", "median_fee_sat_vb", null, "max"),
        mk("scatter", "Transactions vs fees", "Busier blocks pay more?", 84, "tx_count", "total_fees_btc", "pool"),
      ].slice(0, 5),
    };
  }

  if (kind === "debt") {
    return {
      title: "US national debt",
      charts: [
        mk("line", "Total public debt", "Every business day since 1993 (US$)", 98, "record_date", "total_debt", null, "max"),
        mk("line", "Held by the public", "Debt owned outside the federal government", 92, "record_date", "held_by_public", null, "max"),
        mk("line", "Intragovernmental", "Debt the government owes itself (trust funds)", 86, "record_date", "intragovernmental", null, "max"),
      ].slice(0, 5),
    };
  }

  return { title: `${kind} data`, charts: [] };
}

/** SQL queries for each source kind. */
export const SOURCE_SQL_SNIPPETS: Record<string, { name: string; sql: string }[]> = {
  usgs: [
    { name: "Recent quakes", sql: "SELECT place, magnitude, depth, ts FROM usgs_quakes ORDER BY ts DESC LIMIT 20" },
    { name: "Strongest quakes", sql: "SELECT place, magnitude, depth, latitude, longitude, ts FROM usgs_quakes ORDER BY magnitude DESC LIMIT 15" },
    { name: "Quakes by network", sql: "SELECT net, COUNT(*) AS cnt, AVG(magnitude) AS avg_mag FROM usgs_quakes GROUP BY net ORDER BY cnt DESC" },
    { name: "Tsunami alerts", sql: "SELECT * FROM usgs_quakes WHERE tsunami = true ORDER BY ts DESC" },
  ],
  meteo: [
    { name: "Current conditions", sql: "SELECT city, temperature, humidity, wind_speed, precipitation, ts FROM meteo_weather ORDER BY ts DESC LIMIT 5" },
    { name: "Hottest hours", sql: "SELECT city, temperature, ts FROM meteo_weather ORDER BY temperature DESC LIMIT 20" },
    { name: "City averages", sql: "SELECT city, AVG(temperature) AS avg_temp, AVG(humidity) AS avg_hum, AVG(wind_speed) AS avg_wind FROM meteo_weather GROUP BY city" },
    { name: "Rainy periods", sql: "SELECT city, ts, precipitation, temperature FROM meteo_weather WHERE precipitation > 0 ORDER BY precipitation DESC LIMIT 20" },
  ],
  nws: [
    { name: "Active alerts", sql: "SELECT event, severity, urgency, headline, area_desc FROM nws_alerts ORDER BY effective DESC LIMIT 20" },
    { name: "By severity", sql: "SELECT severity, COUNT(*) AS cnt FROM nws_alerts GROUP BY severity ORDER BY cnt DESC" },
    { name: "By event type", sql: "SELECT event, COUNT(*) AS cnt, MIN(effective) AS first_seen FROM nws_alerts GROUP BY event ORDER BY cnt DESC LIMIT 15" },
    { name: "Extreme alerts", sql: "SELECT * FROM nws_alerts WHERE severity = 'Extreme' OR severity = 'Severe' ORDER BY effective DESC" },
  ],
  world_bank: [
    { name: "Richest per person (latest)", sql: "SELECT country_name, yr, gdp_per_capita FROM world_bank WHERE yr = (SELECT MAX(yr) FROM world_bank WHERE gdp_per_capita IS NOT NULL) AND gdp_per_capita IS NOT NULL ORDER BY gdp_per_capita DESC LIMIT 20" },
    { name: "Most populous (latest)", sql: "SELECT country_name, population FROM world_bank WHERE yr = (SELECT MAX(yr) FROM world_bank WHERE population IS NOT NULL) ORDER BY population DESC LIMIT 20" },
    { name: "Life expectancy trend", sql: "SELECT yr, ROUND(AVG(life_expectancy), 1) AS avg_life_expectancy FROM world_bank GROUP BY yr ORDER BY yr" },
    { name: "CO₂ per person (top)", sql: "SELECT country_name, yr, co2_per_capita FROM world_bank WHERE co2_per_capita IS NOT NULL QUALIFY ROW_NUMBER() OVER (PARTITION BY country_code ORDER BY yr DESC) = 1 ORDER BY co2_per_capita DESC LIMIT 15" },
  ],
  iss: [
    { name: "Latest position", sql: "SELECT * FROM iss_track ORDER BY ts DESC LIMIT 20" },
    { name: "Altitude trail", sql: "SELECT ts, altitude_km, velocity_kmh FROM iss_track ORDER BY ts" },
  ],
  hn: [
    { name: "Top by points", sql: "SELECT title, points, num_comments, author FROM hn_stories ORDER BY points DESC LIMIT 20" },
    { name: "Discussion intensity", sql: "SELECT title, points, num_comments FROM hn_stories ORDER BY num_comments DESC LIMIT 20" },
  ],
  crypto: [
    { name: "Market leaders", sql: "SELECT symbol, name, price_usd, market_cap, change_24h_pct FROM crypto_markets ORDER BY rank ASC LIMIT 20" },
    { name: "Biggest movers", sql: "SELECT symbol, change_24h_pct, price_usd, volume_24h FROM crypto_markets ORDER BY ABS(change_24h_pct) DESC LIMIT 20" },
  ],
  aq: [
    { name: "PM2.5 leaders", sql: "SELECT city, pm2_5, pm10, european_aqi, ts FROM air_quality ORDER BY pm2_5 DESC" },
    { name: "AQI comparison", sql: "SELECT city, european_aqi, ozone, nitrogen_dioxide FROM air_quality ORDER BY european_aqi DESC" },
  ],
  fx: [
    { name: "Latest rates", sql: "SELECT quote, rate, change_pct FROM fx_rates WHERE as_of = (SELECT MAX(as_of) FROM fx_rates) ORDER BY quote" },
    { name: "Most volatile", sql: "SELECT quote, ROUND(STDDEV(change_pct), 3) AS daily_volatility_pct FROM fx_rates GROUP BY quote ORDER BY daily_volatility_pct DESC" },
    { name: "Dollar over time", sql: "SELECT as_of, rate FROM fx_rates WHERE quote = 'USD' ORDER BY as_of" },
  ],
  fema: [
    { name: "Recent declarations", sql: "SELECT state, incident_type, declaration_title, declaration_date FROM fema_disasters ORDER BY declaration_date DESC LIMIT 30" },
    { name: "By incident type", sql: "SELECT incident_type, COUNT(*) AS cnt FROM fema_disasters GROUP BY incident_type ORDER BY cnt DESC" },
    { name: "By state", sql: "SELECT state, COUNT(*) AS cnt FROM fema_disasters GROUP BY state ORDER BY cnt DESC LIMIT 20" },
  ],
  opensky: [
    { name: "Airborne sample", sql: "SELECT callsign, origin_country, latitude, longitude, baro_altitude, velocity FROM opensky_aircraft WHERE NOT on_ground ORDER BY baro_altitude DESC LIMIT 50" },
    { name: "By country", sql: "SELECT origin_country, COUNT(*) AS aircraft FROM opensky_aircraft GROUP BY origin_country ORDER BY aircraft DESC LIMIT 20" },
  ],
  countries: [
    { name: "Population top 30", sql: "SELECT name, region, population, area, density FROM world_countries ORDER BY population DESC LIMIT 30" },
    { name: "By region", sql: "SELECT region, COUNT(*) AS countries, SUM(population) AS pop FROM world_countries GROUP BY region ORDER BY pop DESC" },
  ],
  spacex: [
    { name: "Recent flights", sql: "SELECT name, date_utc, rocket, success FROM spacex_launches ORDER BY date_utc DESC LIMIT 30" },
    { name: "Success rate", sql: "SELECT success, COUNT(*) AS cnt FROM spacex_launches GROUP BY success" },
    { name: "Launches per month", sql: "SELECT date_trunc('month', date_utc) AS month, COUNT(*) AS launches FROM spacex_launches GROUP BY 1 ORDER BY 1" },
  ],
  nyc311: [
    { name: "Top complaints", sql: "SELECT complaint_type, COUNT(*) AS cnt FROM nyc_311 GROUP BY complaint_type ORDER BY cnt DESC LIMIT 20" },
    { name: "By borough", sql: "SELECT borough, COUNT(*) AS cnt FROM nyc_311 GROUP BY borough ORDER BY cnt DESC" },
  ],
  covid: [
    { name: "Cases leaders", sql: "SELECT country, cases, deaths, today_cases, continent FROM covid_countries ORDER BY cases DESC LIMIT 30" },
    { name: "Per million", sql: "SELECT country, cases_per_million, deaths_per_million FROM covid_countries ORDER BY cases_per_million DESC LIMIT 30" },
  ],
  launches: [
    { name: "Upcoming", sql: "SELECT name, net, agency, location, rocket, status FROM space_launches ORDER BY net ASC LIMIT 40" },
    { name: "By agency", sql: "SELECT agency, COUNT(*) AS cnt FROM space_launches GROUP BY agency ORDER BY cnt DESC" },
  ],
  eonet: [
    { name: "Open events", sql: "SELECT title, category, ts, latitude, longitude FROM natural_events ORDER BY ts DESC LIMIT 50" },
    { name: "By category", sql: "SELECT category, COUNT(*) AS events FROM natural_events GROUP BY category ORDER BY events DESC" },
  ],
  citibike: [
    { name: "Emptiest docks", sql: "SELECT name, capacity, bikes_available, docks_available FROM citibike_stations WHERE is_renting AND capacity > 0 ORDER BY pct_full ASC LIMIT 25" },
    { name: "System totals", sql: "SELECT COUNT(*) AS stations, SUM(bikes_available) AS bikes, SUM(ebikes_available) AS ebikes, SUM(docks_available) AS open_docks FROM citibike_stations" },
  ],
  spaceweather: [
    { name: "Storm periods", sql: "SELECT ts, kp, storm_level FROM space_weather WHERE kp >= 5 ORDER BY ts DESC" },
    { name: "Daily peak Kp", sql: "SELECT CAST(ts AS DATE) AS day, MAX(kp) AS peak_kp FROM space_weather GROUP BY 1 ORDER BY 1" },
  ],
  ukcarbon: [
    { name: "Greenest half hours", sql: "SELECT ts, forecast, actual, intensity_index FROM uk_carbon ORDER BY forecast ASC LIMIT 10" },
    { name: "Forecast error", sql: "SELECT ts, forecast, actual, actual - forecast AS error FROM uk_carbon WHERE actual IS NOT NULL ORDER BY ts" },
  ],
  pageviews: [
    { name: "Top 25", sql: "SELECT rank, article, views FROM wiki_top_articles ORDER BY rank LIMIT 25" },
    { name: "Share of top 100", sql: "SELECT article, views, ROUND(100.0 * views / SUM(views) OVER (), 1) AS pct FROM wiki_top_articles ORDER BY views DESC LIMIT 25" },
  ],
  gdacs: [
    { name: "Red & orange alerts", sql: "SELECT event_type, title, country, alert_level, start_ts FROM disaster_alerts WHERE alert_level IN ('Red', 'Orange') ORDER BY alert_score DESC" },
    { name: "By type", sql: "SELECT event_type, COUNT(*) AS events FROM disaster_alerts GROUP BY event_type ORDER BY events DESC" },
  ],
  buoys: [
    { name: "Biggest waves", sql: "SELECT station, latitude, longitude, wave_height_m, wind_speed_ms FROM ocean_buoys WHERE wave_height_m IS NOT NULL ORDER BY wave_height_m DESC LIMIT 20" },
    { name: "Warmest water", sql: "SELECT station, latitude, longitude, water_temp_c FROM ocean_buoys WHERE water_temp_c IS NOT NULL ORDER BY water_temp_c DESC LIMIT 20" },
  ],
  mbta: [
    { name: "Vehicles by mode", sql: "SELECT route_type, COUNT(*) AS vehicles FROM mbta_vehicles GROUP BY route_type ORDER BY vehicles DESC" },
    { name: "Crowded right now", sql: "SELECT route, label, occupancy, status FROM mbta_vehicles WHERE occupancy IS NOT NULL ORDER BY occupancy" },
  ],
  aurora: [
    { name: "Best chances", sql: "SELECT latitude, longitude, probability FROM aurora_forecast ORDER BY probability DESC LIMIT 25" },
    { name: "By hemisphere", sql: "SELECT CASE WHEN latitude >= 0 THEN 'North' ELSE 'South' END AS hemisphere, MAX(probability) AS peak, AVG(probability) AS mean FROM aurora_forecast GROUP BY 1" },
  ],
  asteroids: [
    { name: "Closest passes", sql: "SELECT name, approach_ts, distance_ld, velocity_kms, diameter_m FROM asteroid_approaches ORDER BY distance_ld ASC LIMIT 15" },
    { name: "Biggest", sql: "SELECT name, diameter_m, distance_ld, approach_ts FROM asteroid_approaches ORDER BY diameter_m DESC LIMIT 10" },
  ],
  steam: [
    { name: "Most played", sql: "SELECT name, developer, peak_players, positive_pct, price_usd FROM steam_games ORDER BY peak_players DESC LIMIT 25" },
    { name: "Best reviewed", sql: "SELECT name, positive_pct, positive + negative AS reviews FROM steam_games WHERE positive + negative > 1000 ORDER BY positive_pct DESC LIMIT 20" },
  ],
  bitcoin: [
    { name: "Latest blocks", sql: "SELECT height, ts, pool, tx_count, median_fee_sat_vb FROM bitcoin_blocks ORDER BY height DESC LIMIT 20" },
    { name: "Pool share", sql: "SELECT pool, COUNT(*) AS blocks FROM bitcoin_blocks GROUP BY pool ORDER BY blocks DESC" },
  ],
  debt: [
    { name: "Latest", sql: "SELECT record_date, total_debt, held_by_public, intragovernmental FROM us_debt ORDER BY record_date DESC LIMIT 10" },
    { name: "Yearly growth", sql: "SELECT EXTRACT(year FROM record_date) AS yr, MAX(total_debt) - MIN(total_debt) AS added FROM us_debt GROUP BY 1 ORDER BY 1" },
  ],
  climate: [
    { name: "Warmest years", sql: "SELECT year, ROUND(AVG(anomaly_c), 2) AS anomaly_c FROM global_temperature GROUP BY year ORDER BY anomaly_c DESC LIMIT 15" },
    { name: "By decade", sql: "SELECT (year // 10) * 10 AS decade, ROUND(AVG(anomaly_c), 2) AS anomaly_c FROM global_temperature GROUP BY 1 ORDER BY 1" },
  ],
};

/** SQL queries that work well with the wiki_stream table for the Query view. */
export const STREAM_SQL_SNIPPETS = [
  {
    name: "Edits per minute",
    sql: "SELECT date_trunc('minute', ts) AS minute, COUNT(*) AS edits FROM wiki_stream GROUP BY 1 ORDER BY 1",
  },
  {
    name: "Top 10 wikis",
    sql: "SELECT wiki, COUNT(*) AS edits FROM wiki_stream GROUP BY wiki ORDER BY edits DESC LIMIT 10",
  },
  {
    name: "Bot ratio",
    sql: "SELECT bot, COUNT(*) AS cnt, ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) AS pct FROM wiki_stream GROUP BY bot",
  },
  {
    name: "Biggest edits",
    sql: "SELECT title, wiki, \"user\", delta, ts FROM wiki_stream ORDER BY ABS(delta) DESC LIMIT 20",
  },
  {
    name: "Active editors",
    sql: "SELECT \"user\", COUNT(*) AS edits, SUM(delta) AS total_delta FROM wiki_stream WHERE NOT bot GROUP BY 1 ORDER BY edits DESC LIMIT 15",
  },
  {
    name: "Namespace breakdown",
    sql: "SELECT namespace, COUNT(*) AS edits, AVG(delta) AS avg_delta FROM wiki_stream GROUP BY namespace ORDER BY edits DESC",
  },
];
