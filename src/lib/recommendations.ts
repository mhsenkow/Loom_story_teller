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

export type ChartKind = "scatter" | "bar" | "histogram" | "line" | "heatmap" | "strip" | "box" | "area" | "pie";

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
  { value: "line", label: "Line" },
  { value: "bar", label: "Bar (rect)" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
  { value: "histogram", label: "Histogram" },
  { value: "strip", label: "Strip" },
  { value: "box", label: "Box" },
  { value: "heatmap", label: "Heatmap" },
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
  visualEncoding?: { glowField?: string | null; outlineField?: string | null; opacityField?: string | null },
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
  },
): ChartRecommendation | null {
  const numCols = columns.filter(c => inferType(c.data_type, c.name) === "quantitative");
  const nomCols = columns.filter(c => inferType(c.data_type, c.name) === "nominal");
  const timeCols = columns.filter(c => inferType(c.data_type, c.name) === "temporal");
  const sizeField = extra?.sizeField ?? null;
  const rowField = extra?.rowField ?? null;
  const glowField = extra?.glowField ?? null;
  const outlineField = extra?.outlineField ?? null;
  const opacityField = extra?.opacityField ?? null;
  const yAggregate = extra?.yAggregate ?? null;

  if (kind === "scatter") {
    if (!yField || !numCols.some(c => c.name === xField) || !numCols.some(c => c.name === yField)) return null;
    return createScatterRec(columns, xField, yField, colorField, tableName, sizeField, {
      glowField,
      outlineField,
      opacityField,
    });
  }

  const id = `${kind}-${xField}-${yField ?? "n"}-${colorField ?? "n"}${rowField ? `-row:${rowField}` : ""}`;
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
      enc.y = yField
        ? { field: yField, type: "quantitative", aggregate: agg }
        : { aggregate: "count", type: "quantitative" };
      enc.color = { value: COLORS[0] };
      if (rowField) enc.row = { field: rowField, type: "nominal", header: { title: rowField } };
      title = yField ? `${aggLabel(agg)} of ${yField} by ${xField}` : `Count by ${xField}`;
      subtitle = rowField ? `by ${rowField}` : (yField ? "grouped" : "rows per category");
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
      enc.color = { field: yField, type: "nominal", scale: { range: COLORS }, legend: null };
      if (sizeField) enc.size = { field: sizeField, type: "quantitative", scale: { range: [2, 12] } };
      title = `${xField} by ${yField}`;
      subtitle = sizeField ? `size by ${sizeField}` : "strip plot";
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
    "rect";

  const effectiveYAggregate: YAggregateOption | undefined =
    (kind === "bar" || kind === "line" || kind === "area" || kind === "pie")
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

  // Sort by score descending, cap at 18 so more types show up
  recs.sort((a, b) => b.score - a.score);
  return recs.slice(0, 18);
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
): { xField: string; yField: string | null; colorField: string | null } | null {
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
      return { xField: x.name, yField: y.name, colorField: color?.name ?? null };
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
      return { xField: xStrip.name, yField: yStrip.name, colorField: null };
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
    default:
      return null;
  }
}

/** Pick a random chart kind and valid encoding. */
export function getRandomChartAndEncoding(
  columns: ColumnInfo[],
): { kind: ChartKind; xField: string; yField: string | null; colorField: string | null } | null {
  const kinds: ChartKind[] = ["scatter", "bar", "histogram", "line", "area", "pie", "heatmap", "strip", "box"];
  const shuffled = [...kinds].sort(() => Math.random() - 0.5);
  for (const kind of shuffled) {
    const enc = getRandomEncoding(columns, kind);
    if (enc) return { kind, ...enc };
  }
  return null;
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
      return yField ? "Category vs value (sum/mean/count) → compare groups" : "Count by category";
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
    default:
      return "Fits your column types and cardinality";
  }
}
