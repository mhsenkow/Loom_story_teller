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

const COLORS = [
  "#6c5ce7", "#00d68f", "#ff6b6b", "#ffd93d",
  "#00b4d8", "#e77c5c", "#a29bfe", "#74b9ff",
];

const DARK_AXIS = {
  labelColor: "#6b6b78",
  titleColor: "#e8e8ec",
  gridColor: "#2a2a30",
  domainColor: "#2a2a30",
  labelFont: "JetBrains Mono, monospace",
  labelFontSize: 10,
  titleFontSize: 11,
};

export type ChartKind = "scatter" | "bar" | "histogram" | "line" | "heatmap" | "strip" | "box" | "area" | "pie" | "bubble" | "violin" | "radar" | "waterfall" | "lollipop" | "treemap" | "sunburst" | "choropleth" | "forceBubble" | "sankey";

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
  { value: "line", label: "Line" },
  { value: "bar", label: "Bar (rect)" },
  { value: "lollipop", label: "Lollipop" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
  { value: "histogram", label: "Histogram" },
  { value: "waterfall", label: "Waterfall" },
  { value: "strip", label: "Strip" },
  { value: "violin", label: "Violin" },
  { value: "box", label: "Box" },
  { value: "radar", label: "Radar" },
  { value: "heatmap", label: "Heatmap" },
  { value: "treemap", label: "Treemap" },
  { value: "sunburst", label: "Sunburst" },
  { value: "forceBubble", label: "Force Bubble" },
  { value: "sankey", label: "Sankey" },
  { value: "choropleth", label: "Choropleth" },
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
    encoding.size = { field: sizeField, type: "quantitative", scale: { range: [20, 200] } };
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
      sizeField = sizeField
        ?? numCols.find(c => c.name !== xField && c.name !== yField)?.name
        ?? null;
      enc.x = { field: xField, type: "quantitative" };
      enc.y = { field: yField, type: "quantitative" };
      if (sizeField) enc.size = { field: sizeField, type: "quantitative", scale: { range: [20, 800] } };
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
      subtitle = `geographic — ${xField}`;
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
      if (!yField && !colorField) return null;
      const target = colorField ?? yField!;
      enc.x = { field: xField, type: "nominal" };
      enc.y = { field: target, type: "nominal" };
      title = `${xField} → ${target}`;
      subtitle = "flow between categories";
      break;
    }
    default:
      return null;
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
    kind === "treemap" ? { type: "rect" as const } :
    kind === "sunburst" ? { type: "arc" as const } :
    kind === "choropleth" ? { type: "geoshape" as const } :
    kind === "forceBubble" ? { type: "circle" as const, opacity: 0.75 } :
    kind === "sankey" ? { type: "rect" as const } :
    "rect";

  const effectiveYAggregate: YAggregateOption | undefined =
    (kind === "bar" || kind === "line" || kind === "area" || kind === "pie" || kind === "waterfall" || kind === "lollipop" || kind === "radar" || kind === "treemap" || kind === "sunburst" || kind === "forceBubble")
      ? (!yField ? "count" : (yAggregate ?? (kind === "line" ? "mean" : "sum")))
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
): ChartRecommendation[] {
  const recs: ChartRecommendation[] = [];
  const name = fileName.replace(/\.\w+$/, "");

  const numCols = columns.filter(c => inferType(c.data_type, c.name) === "quantitative");
  const nomCols = columns.filter(c => inferType(c.data_type, c.name) === "nominal");
  const timeCols = columns.filter(c => inferType(c.data_type, c.name) === "temporal");

  // --- SCATTER: every pair of numeric columns ---
  for (let i = 0; i < numCols.length && i < 4; i++) {
    for (let j = i + 1; j < numCols.length && j < 5; j++) {
      const x = numCols[i];
      const y = numCols[j];
      const colorCol = nomCols.length > 0 ? nomCols[0] : null;

      const encoding: Record<string, unknown> = {
        x: { field: x.name, type: "quantitative" },
        y: { field: y.name, type: "quantitative" },
      };
      if (colorCol && colorCol.distinct_count <= 20) {
        encoding.color = { field: colorCol.name, type: "nominal", scale: { range: COLORS } };
      }

      let score = 70;
      if (x.distinct_count > 50 && y.distinct_count > 50) score += 15;
      if (colorCol && colorCol.distinct_count >= 2 && colorCol.distinct_count <= 10) score += 10;

      recs.push({
        id: `scatter-${x.name}-${y.name}`,
        kind: "scatter",
        title: `${x.name} vs ${y.name}`,
        subtitle: colorCol ? `colored by ${colorCol.name}` : "numeric relationship",
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
      let score = 62;
      if (nom.distinct_count >= 3 && nom.distinct_count <= 20) score += 15;

      recs.push({
        id: `bar-sum-${nom.name}-${num.name}`,
        kind: "bar",
        title: `Sum of ${num.name} by ${nom.name}`,
        subtitle: `total ${num.name}, grouped`,
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
      });
    }
  }

  // --- BAR: nominal × numeric (mean) — good for "average cost by state" etc. ---
  for (const nom of nomCols.slice(0, 4)) {
    if (nom.distinct_count < 2 || nom.distinct_count > 40) continue;
    for (const num of numCols.slice(0, 4)) {
      recs.push({
        id: `bar-mean-${nom.name}-${num.name}`,
        kind: "bar",
        title: `Average ${num.name} by ${nom.name}`,
        subtitle: `mean per group`,
        score: 58,
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
        let score = 64;
        if (xNom.distinct_count <= 8 && cNom.distinct_count >= 3) score += 8;
        recs.push({
          id: `bar-facet-sum-${xNom.name}-${cNom.name}-${num.name}`,
          kind: "bar",
          title: `Sum of ${num.name} by ${xNom.name} × ${cNom.name}`,
          subtitle: `grouped by ${cNom.name}`,
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
    for (const num of numCols.slice(0, 3)) {
      const groupCol = nomCols.length > 0 && nomCols[0].distinct_count <= 12 ? nomCols[0] : null;
      let score = 75;
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
          subtitle: colorCol ? `colored by ${colorCol.name}` : "three-variable view",
          score: 73,
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

  // --- CHOROPLETH: nominal with geo-like names × numeric ---
  const geoPatterns = /^(country|state|province|region|iso|code|fips|geo|territory|nation|county)/i;
  const geoCol = nomCols.find(c => geoPatterns.test(c.name) && c.distinct_count >= 3);
  if (geoCol) {
    for (const num of numCols.slice(0, 2)) {
      recs.push({
        id: `choropleth-${geoCol.name}-${num.name}`,
        kind: "choropleth",
        title: `${num.name} by ${geoCol.name}`,
        subtitle: `geographic — ${geoCol.name}`,
        score: 72,
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

  // Sort by score descending, cap at 30 so new types show up too
  recs.sort((a, b) => b.score - a.score);
  return recs.slice(0, 30);
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

  // 4. Relationship (scatter)
  const scatter = pick("scatter");
  if (scatter && !used.has(scatter.id)) {
    sequence.push(scatter);
    used.add(scatter.id);
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
  return recs.reduce((best, r) => (r.score > best.score ? r : best), recs[0]);
}

/** Pick a random valid encoding for the given chart kind. Returns null if no valid combo. */
export function getRandomEncoding(
  columns: ColumnInfo[],
  kind: ChartKind,
): { xField: string; yField: string | null; colorField: string | null; sizeField?: string | null } | null {
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
      const yVal = numCols.length > 0 ? pick(numCols)! : null;
      const colorLine = nomCols.length > 0 && nomCols.some(c => c.distinct_count <= 15) ? pick(nomCols.filter(c => c.distinct_count <= 15)) ?? null : null;
      return { xField: xTime.name, yField: yVal?.name ?? null, colorField: colorLine?.name ?? null };
    }
    case "heatmap": {
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
      if (numCols.length < 3) return null;
      const shuffled = [...numCols].sort(() => Math.random() - 0.5);
      const color = nomCols.length > 0 && nomCols.some(c => c.distinct_count <= 15) ? pick(nomCols.filter(c => c.distinct_count <= 15)) ?? null : null;
      return { xField: shuffled[0].name, yField: shuffled[1].name, colorField: color?.name ?? null, sizeField: shuffled[2].name };
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
      const yWf = pick(numCols);
      if (!xWf || !yWf) return null;
      return { xField: xWf.name, yField: yWf.name, colorField: null };
    }
    case "lollipop": {
      const xLol = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 30));
      if (!xLol) return null;
      const yLol = numCols.length > 0 ? pick(numCols)! : null;
      const colorLol = nomCols.length > 1 && Math.random() > 0.6 ? pick(nomCols.filter(c => c.name !== xLol.name && c.distinct_count <= 10)) ?? null : null;
      return { xField: xLol.name, yField: yLol?.name ?? null, colorField: colorLol?.name ?? null };
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
      const geoP = /^(country|state|province|region|iso|code|fips|geo|territory|nation|county)/i;
      const geoCols = nomCols.filter(c => geoP.test(c.name) && c.distinct_count >= 3);
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
      const a = pick(nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 20))!;
      const b = pick(nomCols.filter(c => c.name !== a.name && c.distinct_count >= 2 && c.distinct_count <= 20));
      if (!b) return null;
      const yVal = numCols.length > 0 && Math.random() > 0.3 ? pick(numCols)! : null;
      return { xField: a.name, yField: yVal?.name ?? null, colorField: b.name };
    }
    default:
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
  const geoP = /^(country|state|province|region|iso|code|fips|geo|territory|nation|county)/i;

  switch (kind) {
    case "scatter":
      return numCols.length >= 2 ? { ok: true, reason: "" } : { ok: false, reason: "Need ≥2 numeric columns" };
    case "bubble":
      return numCols.length >= 3 ? { ok: true, reason: "" } : { ok: false, reason: "Need ≥3 numeric columns" };
    case "histogram":
      return numCols.length >= 1 ? { ok: true, reason: "" } : { ok: false, reason: "Need a numeric column" };
    case "bar":
    case "lollipop":
      return nom(2, kind === "lollipop" ? 30 : 50).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (2–" + (kind === "lollipop" ? "30" : "50") + " distinct values)" };
    case "line":
    case "area":
      return (timeCols.length > 0 || nomCols.length > 0)
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a date/time or text column for X" };
    case "pie":
      return nom(2, 15).length >= 1 ? { ok: true, reason: "" } : { ok: false, reason: "Need a category (2–15 distinct)" };
    case "heatmap":
      return nom(2, 20).length >= 2 ? { ok: true, reason: "" } : { ok: false, reason: "Need two categories (2–20 distinct each)" };
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
      return nom(3, 20).length >= 1 && numCols.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need category (3–20 values) + numeric" };
    case "treemap":
      return nom(3, 30).length >= 1 && numCols.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need category (3–30 values) + numeric" };
    case "sunburst":
      return nom(3, 20).length >= 1 && numCols.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need category (3–20 values) + numeric" };
    case "forceBubble":
      return nom(3, 40).length >= 1 && numCols.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need category (3–40 values) + numeric" };
    case "choropleth": {
      const geo = nomCols.filter(c => geoP.test(c.name) && c.distinct_count >= 3);
      const any = nomCols.filter(c => c.distinct_count >= 3);
      return geo.length >= 1 || any.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a region-like or categorical column (≥3 distinct)" };
    }
    case "sankey":
      return nomCols.filter(c => c.distinct_count >= 2 && c.distinct_count <= 20).length >= 2
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need two categories (2–20 distinct each)" };
    default:
      return { ok: true, reason: "" };
  }
}

/**
 * Random chart that passes createChartRec (encoding + schema). Retries random encodings;
 * falls back to top recommend() result.
 */
export function tryBuildRandomChartRec(columns: ColumnInfo[], tableName: string): ChartRecommendation | null {
  if (columns.length === 0) return null;
  for (let round = 0; round < 4; round++) {
    const shuffled = [...ALL_CHART_KINDS].sort(() => Math.random() - 0.5);
    for (const kind of shuffled) {
      for (let att = 0; att < 14; att++) {
        const enc = getRandomEncoding(columns, kind);
        if (!enc) break;
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
    case "treemap":
      return "Nested rectangles → part-of-whole with optional hierarchy";
    case "sunburst":
      return "Radial slices → hierarchical composition at a glance";
    case "choropleth":
      return "Geographic regions → values mapped to color on a map";
    case "forceBubble":
      return "Packed circles → size comparison without axes, grouped by category";
    case "sankey":
      return "Two categories → flow and volume between groups";
    default:
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
  ): ChartRecommendation => ({
    id: mkId(), kind: k, title, subtitle, score, spec: {},
    xField, yField, colorField, yAggregate: yAgg ?? null,
  });

  if (kind === "usgs") {
    return {
      title: "Earthquake Analytics",
      charts: [
        mk("scatter", "Quakes by location", "Latitude vs longitude — where do they cluster?", 95, "longitude", "latitude", "mag_type"),
        mk("histogram", "Magnitude distribution", "How strong are the quakes?", 90, "magnitude", null, null),
        mk("line", "Quakes over time", "Temporal pattern of seismic activity", 88, "ts", null, null, "count"),
        mk("bar", "Quakes by network", "Which seismic networks report most?", 85, "net", null, null, "count"),
        mk("scatter", "Depth vs magnitude", "Do deeper quakes tend to be stronger?", 82, "depth", "magnitude", null),
      ].slice(0, 5),
    };
  }

  if (kind === "meteo") {
    return {
      title: "World Weather Comparison",
      charts: [
        mk("line", "Temperature over time", "How does temperature vary across cities?", 95, "ts", "temperature", "city"),
        mk("bar", "Average temperature by city", "Compare baseline temps", 90, "city", "temperature", null, "mean"),
        mk("line", "Wind speed trends", "Wind patterns across locations", 85, "ts", "wind_speed", "city"),
        mk("bar", "Precipitation by city", "Who gets the most rain?", 82, "city", "precipitation", null, "sum"),
        mk("histogram", "Humidity distribution", "Global humidity spread", 78, "humidity", null, null),
      ].slice(0, 5),
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
      title: "Global Development Indicators",
      charts: [
        mk("bar", "GDP by country (latest)", "Economic output across nations", 95, "country_name", "value", null, "max"),
        mk("line", "Indicators over time", "How do key metrics change globally?", 90, "yr", "value", "indicator_name", "mean"),
        mk("bar", "Top 10 by population", "Most populous nations", 85, "country_name", "value", null, "max"),
        mk("scatter", "Year vs indicator value", "How values evolve over time (per country)", 82, "yr", "value", "country_code"),
        mk("histogram", "Value distribution", "Spread of indicator values", 78, "value", null, null),
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
    { name: "GDP rankings (2023)", sql: "SELECT country_name, value FROM world_bank WHERE indicator_id = 'NY.GDP.MKTP.CD' AND yr = 2023 ORDER BY value DESC LIMIT 20" },
    { name: "Population (2023)", sql: "SELECT country_name, value FROM world_bank WHERE indicator_id = 'SP.POP.TOTL' AND yr = 2023 ORDER BY value DESC LIMIT 20" },
    { name: "Life expectancy trend", sql: "SELECT yr, AVG(value) AS avg_le FROM world_bank WHERE indicator_id = 'SP.DYN.LE00.IN' GROUP BY yr ORDER BY yr" },
    { name: "CO₂ top emitters", sql: "SELECT country_name, value FROM world_bank WHERE indicator_id = 'EN.ATM.CO2E.PC' AND yr = 2022 ORDER BY value DESC LIMIT 15" },
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
