// =================================================================
// createChartRec — build one ChartRecommendation (Vega-Lite spec + encodings) for a kind.
// (split from recommendations.ts — LOOM-195; public API re-exported there)
// =================================================================

import { chartTimeWindowLabel, fieldLooksFutureDated } from "../chartTime";
import { parseChartEmojiMap, type ChartEmojiMap } from "../chartEmoji";
import { COLORS, defaultLineAreaAggregate, inferType, measureColumns } from "./columns";
import { isGeoRegionField } from "../geoFields";
import { buildGeoMapRec, isGeoMapKind } from "../geoMapsRec";
import { buildGpuSceneRec, isGpuSceneKind } from "../gpuScenesRec";
import { buildOddChartRec, isOddChartKind } from "../oddChartsRec";
import { type ColumnInfo } from "../queryTypes";
import { CHART_KIND_OPTIONS, type ChartKind, type ChartRecommendation, type YAggregateOption } from "./types";
import { vegaBaseConfigForTheme } from "../vegaThemeConfig";

export function baseConfig() {
  return vegaBaseConfigForTheme("dark");
}

/** Parse external / handoff chart kind strings; null when unknown. */
export function parseChartKind(raw: string): ChartKind | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const kinds = CHART_KIND_OPTIONS.map((o) => o.value);
  const direct = kinds.find((k) => k === trimmed);
  if (direct) return direct;
  const lower = trimmed.toLowerCase();
  const ci = kinds.find((k) => k.toLowerCase() === lower);
  if (ci) return ci;
  const norm = lower.replace(/[-_\s]/g, "");
  return kinds.find((k) => k.toLowerCase().replace(/[-_\s]/g, "") === norm) ?? null;
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
    shapeField?: string | null;
    emojiField?: string | null;
    emojiMap?: ChartEmojiMap | null;
    rowField?: string | null;
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
  const rowField = visualEncoding?.rowField ?? null;
  if (rowField) {
    encoding.row = { field: rowField, type: "nominal", header: { title: rowField } };
  }
  const colorCol = colorField ? columns.find(c => c.name === colorField) : null;
  const mark: { type: "circle"; opacity: number; size?: number } = { type: "circle", opacity: 0.65 };
  if (!sizeField) mark.size = 12;
  const parts = [
    sizeField ? `size by ${sizeField}` : null,
    colorCol ? `colored by ${colorCol.name}` : null,
    rowField ? `facets by ${rowField}` : null,
  ].filter(Boolean);
  return {
    id: `scatter-${xField}-${yField}-${colorField ?? "n"}-${sizeField ?? "n"}${rowField ? `-row:${rowField}` : ""}`,
    kind: "scatter",
    title: `${xField} vs ${yField}`,
    subtitle: parts.length ? parts.join("; ") : "numeric relationship",
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
    rowField: rowField ?? undefined,
    glowField: visualEncoding?.glowField ?? undefined,
    outlineField: visualEncoding?.outlineField ?? undefined,
    opacityField: visualEncoding?.opacityField ?? undefined,
    tooltipFields: visualEncoding?.tooltipFields ?? undefined,
    tooltipKeyField: visualEncoding?.tooltipKeyField ?? undefined,
  };
}

/** Kinds whose X (or slice / stage / identity) is a category. */
export const CATEGORY_X_KINDS = new Set<string>([
  "bar", "pareto", "lollipop", "pie", "treemap", "sunburst", "forceBubble", "funnel", "waterfall", "box", "violin",
  "beeswarm", "dumbbell", "pyramid", "slope", "radialBar", "waffle", "isotype", "isoBars", "mosaic",
  "chord", "sankey", "network", "arcDiagram", "bucketField",
]);
/** One glyph per row/entity — an identity column (country, name) rather than a few groups. */
export const IDENTITY_X_KINDS = new Set<string>(["chernoff", "glyphStar", "flower"]);
/** Kinds whose Y is the group axis. */
export const CATEGORY_Y_KINDS = new Set<string>(["strip", "ridgeline"]);
/** Kinds whose X is an ordering — time reads best. */
export const ORDERED_X_KINDS = new Set<string>(["line", "area", "bump", "stream", "horizon", "spiral"]);
/** Kinds that place marks on two continuous axes (density, territories, points). */
export const NUMERIC_XY_KINDS = new Set<string>(["scatter", "bubble", "hexbin", "contour", "isoScatter", "voronoi"]);
/** Kinds that bin a numeric X (Y is a count). */
export const NUMERIC_X_KINDS = new Set<string>(["histogram"]);
/** Kinds that plot a numeric Y against their X (no count fallback). */
export const NUMERIC_Y_KINDS = new Set<string>([
  "line", "area", "bump", "stream", "horizon", "spiral", "box", "violin", "beeswarm", "dumbbell", "slope", "pyramid",
]);
/** Kinds that split a whole into parts — slice sizes need non-negative totals. */
export const PART_TO_WHOLE_KINDS = new Set<string>([
  "pie", "treemap", "sunburst", "waffle", "isotype", "forceBubble", "radialBar", "funnel", "mosaic", "pareto",
]);
/** Kinds where Color is a required second category (target / segment). */
export const CATEGORY_COLOR_KINDS = new Set<string>(["mosaic", "chord", "sankey", "network", "arcDiagram"]);

/**
 * Adapt an encoding when switching chart type: keep fields that suit the new kind,
 * and swap in a fitting column where they don't — so turning a units × revenue
 * scatter into a bar groups by a real category instead of 500 distinct numbers.
 */
export function fitEncodingToKind(
  kind: ChartKind,
  columns: ColumnInfo[],
  enc: { xField: string; yField: string | null; colorField: string | null },
  opts?: { lockedColorField?: string | null },
): { xField: string; yField: string | null; colorField: string | null } {
  const byName = new Map(columns.map((c) => [c.name, c]));
  const typeOf = (c: ColumnInfo) => inferType(c.data_type, c.name, c.min_value, c.max_value);
  const lockedColor = opts?.lockedColorField?.trim() || null;
  if (lockedColor && byName.has(lockedColor)) {
    enc = { ...enc, colorField: lockedColor };
  }
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
  const measures = measureColumns(columns);
  const pickMeasure = (avoid: string | null) =>
    (measures.find((c) => c.name !== avoid) ?? columns.find((c) => typeOf(c) === "quantitative" && c.name !== avoid))?.name ?? null;

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
  } else if (NUMERIC_XY_KINDS.has(kind) || NUMERIC_X_KINDS.has(kind)) {
    const prevX = xField;
    if (!isNumeric(xField)) xField = pickMeasure(yField) ?? xField;
    if (NUMERIC_XY_KINDS.has(kind) && !isNumeric(yField)) yField = pickMeasure(xField) ?? yField;
    // The category that was on X still tells the story — keep it as color
    // (hexbin / histogram color by count, so they don't take it)
    if (prevX !== xField && !colorField && kind !== "hexbin" && !NUMERIC_X_KINDS.has(kind) && isCategory(prevX, 12) && !isNumeric(prevX)) {
      colorField = prevX;
    }
  } else if (CATEGORY_Y_KINDS.has(kind)) {
    if (!isCategory(yField)) {
      // A category on X is about to move off it (X must be numeric) — it's fair game for Y
      const exclude = new Set(isNumeric(xField) ? [xField, colorField] : [colorField]);
      const alt = bestCategory(exclude) ?? (isCategory(colorField) ? colorField : null);
      if (alt) {
        if (alt === colorField) colorField = null;
        yField = alt;
      }
    }
    if (!isNumeric(xField)) xField = columns.find((c) => typeOf(c) === "quantitative" && c.name !== yField)?.name ?? xField;
  }

  // A signed measure (longitude, Δ%) can't size slices — negative groups vanish and
  // one survivor shows as "100%". Count the rows instead.
  if (PART_TO_WHOLE_KINDS.has(kind) && yField) {
    const min = Number(byName.get(yField)?.min_value);
    if (Number.isFinite(min) && min < 0) yField = null;
  }

  if (ORDERED_X_KINDS.has(kind)) {
    const isTimeLike = (c: ColumnInfo) => typeOf(c) === "temporal" || /^(year|yr|date|day|month|week|ts|time)$/i.test(c.name);
    const cur = byName.get(xField);
    if (!cur || !isTimeLike(cur)) {
      const time = columns.find((c) => isTimeLike(c) && c.name !== yField && c.distinct_count >= 3);
      if (time) xField = time.name;
    }
  }

  // Coming from a count chart (pie of rows) leaves Y empty — these kinds need a measure
  if (NUMERIC_Y_KINDS.has(kind) && !isNumeric(yField)) yField = pickMeasure(xField) ?? yField;

  // Bump ranks series against each other — without a series there is nothing to rank
  if (kind === "bump" && (!colorField || colorField === xField)) {
    colorField = bestCategory(new Set([xField, yField])) ?? colorField;
  }

  // One mark per category: a color field that isn't the category would color each mark by
  // whichever row came first — meaningless (e.g. a lollipop per product colored by city)
  if (
    ["lollipop", "funnel", "waterfall", "pie", "radialBar", "isotype", "waffle", "isoBars"].includes(kind) &&
    colorField !== xField &&
    colorField !== lockedColor
  ) {
    colorField = null;
  }

  if (kind === "heatmap" || kind === "hexbin") {
    return { xField, yField, colorField: isNumeric(colorField) ? colorField : null };
  }
  // Color must be a small set of groups; required kinds get the next-best category
  // Locked color is allowed a wider cardinality so “color by site” survives mark switches.
  if (colorField && colorField !== xField && !isCategory(colorField, colorField === lockedColor ? 80 : 12)) {
    if (colorField !== lockedColor) colorField = null;
  }
  if (CATEGORY_COLOR_KINDS.has(kind) && (!colorField || colorField === xField)) {
    // Flows show their top nodes, so a large category (e.g. 142 countries) still works
    colorField =
      (lockedColor && lockedColor !== xField ? lockedColor : null) ??
      bestCategory(new Set([xField, yField])) ??
      bestCategory(new Set([xField, yField]), true) ??
      colorField;
  }
  if (lockedColor && byName.has(lockedColor) && colorField !== lockedColor) {
    // Prefer lock unless this mark kind forced color === x (pie etc.)
    if (!["pie", "radialBar", "funnel", "waterfall"].includes(kind) || lockedColor === xField) {
      colorField = lockedColor;
    }
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
    shapeField?: string | null;
    emojiField?: string | null;
    emojiMap?: ChartEmojiMap | null;
    yAggregate?: YAggregateOption | null;
    topN?: number | null;
    y2Field?: string | null;
    comparePrevious?: boolean | null;
    tooltipFields?: string[] | null;
    tooltipKeyField?: string | null;
    barStackMode?: "grouped" | "stacked" | "percent";
    rollingWindow?: 7 | 30 | null;
    yScale?: "linear" | "log" | "symlog" | null;
    seriesNormalize?: "index100" | "zscore" | null;
    residualOverlay?: boolean | null;
    anomalyHighlight?: boolean | null;
    bumpMode?: "rank" | "delta" | null;
    pyramidScaleMode?: "auto" | "shared" | "independent" | null;
    deltaDisplay?: "off" | "diff" | "pct" | null;
    timeWindowField?: string | null;
    timeWindow?: "all" | "1h" | "6h" | "24h" | "7d" | "30d" | "90d" | "1y" | null;
    layoutDirection?: "auto" | "up" | "down" | "right" | "left" | null;
  },
): ChartRecommendation | null {
  const numCols = measureColumns(columns);
  const nomCols = columns.filter((c) => inferType(c.data_type, c.name, c.min_value, c.max_value) === "nominal");
  const timeCols = columns.filter((c) => inferType(c.data_type, c.name, c.min_value, c.max_value) === "temporal");
  // undefined = unset (may auto-fill for bubble/dumbbell); null = explicitly cleared
  const sizeFieldProvided = extra != null && "sizeField" in extra;
  let sizeField = sizeFieldProvided ? (extra!.sizeField ?? null) : undefined;
  const rowField = extra?.rowField ?? null;
  const glowField = extra?.glowField ?? null;
  const outlineField = extra?.outlineField ?? null;
  const opacityField = extra?.opacityField ?? null;
  const shapeField = extra?.shapeField ?? null;
  const emojiField = extra?.emojiField ?? null;
  const emojiMap = extra?.emojiMap?.field === emojiField ? parseChartEmojiMap(extra.emojiMap) : undefined;
  const yAggregate = extra?.yAggregate ?? null;
  const topN = extra?.topN ?? null;
  const y2Field = extra?.y2Field && numCols.some((c) => c.name === extra.y2Field) ? extra.y2Field : null;
  const comparePrevious = extra?.comparePrevious ?? null;
  const barStackMode = extra?.barStackMode ?? "grouped";
  const rollingWindow = extra?.rollingWindow ?? null;
  const yScale = extra?.yScale ?? null;
  const seriesNormalize = extra?.seriesNormalize ?? null;
  const residualOverlay = extra?.residualOverlay ?? null;
  const anomalyHighlight = extra?.anomalyHighlight ?? null;
  const bumpMode = extra?.bumpMode ?? null;
  const pyramidScaleMode =
    extra?.pyramidScaleMode === "shared" ||
    extra?.pyramidScaleMode === "independent" ||
    extra?.pyramidScaleMode === "auto"
      ? extra.pyramidScaleMode
      : null;
  const deltaDisplay =
    extra?.deltaDisplay === "diff" || extra?.deltaDisplay === "pct" || extra?.deltaDisplay === "off"
      ? extra.deltaDisplay
      : null;
  const timeWindowField = extra?.timeWindowField ?? null;
  const timeWindow = extra?.timeWindow && extra.timeWindow !== "all" ? extra.timeWindow : null;
  const layoutDirection =
    extra?.layoutDirection && extra.layoutDirection !== "auto" ? extra.layoutDirection : null;
  const timeBit =
    timeWindow && timeWindowField
      ? (chartTimeWindowLabel(
          timeWindow,
          fieldLooksFutureDated(timeWindowField) ? "forward" : "wall",
        )?.toLowerCase() ?? null)
      : null;

  if (kind === "scatter") {
    if (!yField || !numCols.some(c => c.name === xField) || !numCols.some(c => c.name === yField)) return null;
    const scatter = createScatterRec(columns, xField, yField, colorField, tableName, sizeField, {
      glowField,
      outlineField,
      opacityField,
      rowField,
      tooltipFields: extra?.tooltipFields,
      tooltipKeyField: extra?.tooltipKeyField ?? undefined,
    });
    return {
      ...scatter,
      shapeField: shapeField || undefined,
      emojiField: emojiField || undefined,
      emojiMap,
      residualOverlay: residualOverlay || undefined,
      anomalyHighlight: anomalyHighlight || undefined,
      yScale: yScale || undefined,
      timeWindowField: timeWindowField || undefined,
      timeWindow: timeWindow || undefined,
      subtitle: [
        scatter.subtitle,
        residualOverlay ? "residuals vs fit" : null,
        anomalyHighlight ? "anomaly rings" : null,
        yScale && yScale !== "linear" ? `${yScale} Y` : null,
        timeBit,
      ].filter(Boolean).join(" · "),
    };
  }

  if (kind === "corrMatrix") {
    if (numCols.length < 3) return null;
    const labels = numCols.slice(0, 8).map((c) => c.name);
    return {
      id: `corrMatrix-${labels.join("-")}`,
      kind: "corrMatrix",
      title: "Correlation matrix",
      score: 72,
      spec: {},
      xField: labels[0]!,
      yField: labels[1]!,
      colorField: null,
      tooltipFields: labels,
      timeWindowField: timeWindowField || undefined,
      timeWindow: timeWindow || undefined,
      subtitle: timeBit
        ? `Pearson r across ${labels.length} measures · ${timeBit}`
        : `Pearson r across ${labels.length} measures`,
    };
  }

  const barFacetId =
    kind === "bar" &&
    Boolean(colorField && colorField !== xField && nomCols.some((c) => c.name === colorField));
  const dsId =
    `${rollingWindow ? `-roll${rollingWindow}` : ""}` +
    `${seriesNormalize ? `-${seriesNormalize}` : ""}` +
    `${yScale && yScale !== "linear" ? `-${yScale}` : ""}` +
    `${residualOverlay ? "-resid" : ""}` +
    `${anomalyHighlight ? "-anom" : ""}` +
    `${bumpMode === "delta" ? "-delta" : ""}` +
    `${comparePrevious ? "-prev" : ""}` +
    `${y2Field ? `-y2:${y2Field}` : ""}` +
    `${timeWindow && timeWindowField ? `-tw:${timeWindowField}:${timeWindow}` : ""}`;
  const id = `${kind}-${xField}-${yField ?? "n"}-${colorField ?? "n"}${rowField ? `-row:${rowField}` : ""}${barFacetId ? `-${barStackMode}` : ""}${dsId}`;
  const enc: Record<string, unknown> = {};
  let title = "";
  let subtitle = "";

  /** Default aggregate when a measure column is used; count when no yField. */
  const aggForMeasure = (defaultAgg: YAggregateOption): YAggregateOption =>
    !yField ? "count" : (yAggregate ?? defaultAgg);
  const aggLabel = (a: YAggregateOption) =>
    a === "mean" ? "Average" : a === "sum" ? "Sum" : a === "count" ? "Count" : a === "min" ? "Min" : "Max";

  switch (kind) {
    case "bar":
    case "pareto": {
      const agg = aggForMeasure("sum");
      enc.x = { field: xField, type: "nominal", sort: "-y" };
      const yEnc: Record<string, unknown> = yField
        ? { field: yField, type: "quantitative", aggregate: agg }
        : { aggregate: "count", type: "quantitative" };
      const subOk = Boolean(
        kind === "bar" &&
          colorField &&
          colorField !== xField &&
          nomCols.some((c) => c.name === colorField),
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
      if (rowField && kind === "bar") enc.row = { field: rowField, type: "nominal", header: { title: rowField } };
      title = yField ? `${aggLabel(agg)} of ${yField} by ${xField}` : `Count by ${xField}`;
      if (kind === "pareto") {
        title = yField ? `Pareto — ${yField} by ${xField}` : `Pareto — count by ${xField}`;
        subtitle = "bars + cumulative % (80/20)";
      } else if (subOk && colorField) {
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
      {
        const bits: string[] = [];
        if (rowField) bits.push(`by ${rowField}`);
        else if (colorField) bits.push(`split by ${colorField}`);
        if (y2Field) bits.push(`vs ${y2Field}`);
        if (comparePrevious) bits.push("vs earlier half");
        subtitle = bits.length ? bits.join("; ") : "time trend";
      }
      break;
    }
    case "heatmap": {
      if (!yField) return null;
      if (colorField && !numCols.some(c => c.name === colorField)) colorField = null;
      const agg = colorField ? yAggregate ?? "mean" : "count";
      enc.x = { field: xField, type: "nominal" };
      enc.y = { field: yField, type: "nominal" };
      enc.color = { ...(colorField && agg !== "count" ? { field: colorField } : {}), aggregate: agg, type: "quantitative", scale: { scheme: "viridis" } };
      title = `${xField} × ${yField}`;
      subtitle = colorField && agg !== "count" ? `${aggLabel(agg)} of ${colorField} per cell` : "row count per cell";
      break;
    }
    case "strip":
      if (!yField) return null;
      // Canvas strip ignores size — keep encoding honest
      sizeField = null;
      enc.x = { field: xField, type: "quantitative" };
      enc.y = { field: yField, type: "nominal" };
      enc.color = colorField
        ? { field: colorField, type: "nominal", scale: { range: COLORS } }
        : { field: yField, type: "nominal", scale: { range: COLORS }, legend: null };
      title = `${xField} by ${yField}`;
      subtitle = colorField ? `colored by ${colorField}` : "strip plot";
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
      {
        const bits: string[] = [];
        if (rowField) bits.push(`by ${rowField}`);
        else if (colorField) bits.push(`stacked by ${colorField}`);
        if (y2Field) bits.push(`vs ${y2Field}`);
        if (comparePrevious) bits.push("vs earlier half");
        subtitle = bits.length ? bits.join("; ") : "area";
      }
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
      // Auto-pick size only when recommending (sizeField unset) — never overwrite a cleared size
      if (sizeField === undefined) {
        sizeField =
          numCols.find(c => c.name !== xField && c.name !== yField && !/^(year|yr|month|day|week|hour)$/i.test(c.name))?.name
          ?? numCols.find(c => c.name !== xField && c.name !== yField)?.name
          ?? null;
      }
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
      if (sizeField === undefined) {
        sizeField = numCols.find(c => c.name !== xField && c.name !== yField)?.name ?? null;
      }
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
      if (colorField && !numCols.some(c => c.name === colorField)) colorField = null;
      const agg = colorField ? yAggregate ?? "mean" : "count";
      enc.x = { field: xField, type: "quantitative", bin: { maxbins: 20 } };
      enc.y = { field: yField, type: "quantitative", bin: { maxbins: 20 } };
      enc.color = { ...(colorField && agg !== "count" ? { field: colorField } : {}), aggregate: agg, type: "quantitative", scale: { scheme: "viridis" } };
      title = `${xField} × ${yField}`;
      subtitle = colorField && agg !== "count" ? `${aggLabel(agg)} of ${colorField} per hex` : "row count per hex";
      break;
    }
    case "funnel": {
      const agg = aggForMeasure("sum");
      // Canvas funnel ignores colorField
      colorField = null;
      enc.x = { field: xField, type: "nominal", sort: "-y" };
      enc.y = yField
        ? { field: yField, type: "quantitative", aggregate: agg }
        : { aggregate: "count", type: "quantitative" };
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
      // Outer leaf = xField; Nest (colorField) drives the inner ring when set
      enc.color = {
        field: colorField && colorField !== xField ? colorField : xField,
        type: "nominal",
        scale: { range: COLORS },
      };
      if (colorField && colorField !== xField) {
        enc.detail = { field: xField, type: "nominal" };
      }
      title = yField ? `${aggLabel(agg)} of ${yField} by ${xField}` : `Count by ${xField}`;
      subtitle = colorField && colorField !== xField ? `inner ring: ${colorField}` : "sunburst";
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
    case "sankey":
    case "network":
    case "arcDiagram": {
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
      subtitle =
        kind === "network"
          ? weightOk
            ? `network · weighted by ${yField}`
            : "force-directed links"
          : kind === "arcDiagram"
            ? weightOk
              ? `arcs · weighted by ${yField}`
              : "arc diagram of links"
            : weightOk
              ? `weighted by ${yField}`
              : "flow between categories";
      break;
    }
    default: {
      if (isGpuSceneKind(kind)) {
        const gpu = buildGpuSceneRec(kind, columns, xField, yField, colorField, {
          sizeField: sizeField ?? null,
          zField: extra?.zField,
          timeField: extra?.timeField,
          trailId: extra?.trailId,
          yAggregate,
        });
        if (!gpu) return null;
        return {
          ...gpu,
          tooltipFields: extra?.tooltipFields,
          tooltipKeyField: extra?.tooltipKeyField,
          timeWindowField: timeWindowField || undefined,
          timeWindow: timeWindow || undefined,
          // Direction rotates the isometric floor (terrain) — must survive GPU early-return.
          layoutDirection: layoutDirection || undefined,
        };
      }
      if (isGeoMapKind(kind)) {
        const geo = buildGeoMapRec(kind, columns, xField, yField, colorField, {
          sizeField: sizeField ?? null,
          yAggregate,
        });
        if (!geo) return null;
        return {
          ...geo,
          // Trails / arcs connect one entity's rows in time order — keep those picks.
          trailId: extra?.trailId ?? geo.trailId,
          timeField: extra?.timeField ?? geo.timeField,
          shapeField: shapeField || undefined,
          emojiField: emojiField || undefined,
      emojiMap,
          tooltipFields: extra?.tooltipFields,
          tooltipKeyField: extra?.tooltipKeyField,
          timeWindowField: timeWindowField || undefined,
          timeWindow: timeWindow || undefined,
        };
      }
      if (isOddChartKind(kind)) {
        const odd = buildOddChartRec(kind, columns, xField, yField, colorField, tableName, {
          sizeField: sizeField ?? null,
          yAggregate,
        });
        if (!odd) return null;
        // Preserve Encoding extras the odd builder doesn't know about (Top N, Direction, tooltips).
        return {
          ...odd,
          topN: topN ?? undefined,
          bumpMode: bumpMode || undefined,
          pyramidScaleMode: kind === "pyramid" ? (pyramidScaleMode || "auto") : undefined,
          deltaDisplay:
            kind === "pyramid" || kind === "slope"
              ? deltaDisplay && deltaDisplay !== "off"
                ? deltaDisplay
                : undefined
              : undefined,
          tooltipFields: extra?.tooltipFields,
          tooltipKeyField: extra?.tooltipKeyField,
          timeWindowField: timeWindowField || undefined,
          timeWindow: timeWindow || undefined,
          layoutDirection: layoutDirection || undefined,
          shapeField: shapeField || undefined,
          emojiField: emojiField || undefined,
          emojiMap,
        };
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
    kind === "sankey" || kind === "network" || kind === "arcDiagram" ? { type: "rect" as const } :
    kind === "pareto" ? { type: "bar" as const, cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 } :
    "rect";

  const effectiveYAggregate: YAggregateOption | undefined =
    kind === "heatmap" || kind === "hexbin" ? (colorField ? yAggregate ?? "mean" : "count") :
    kind === "bar" ||
    kind === "pareto" ||
    kind === "line" ||
    kind === "area" ||
    kind === "pie" ||
    kind === "waterfall" ||
    kind === "lollipop" ||
    kind === "radar" ||
    kind === "treemap" ||
    kind === "sunburst" ||
    kind === "forceBubble" ||
    kind === "funnel" ||
    kind === "dumbbell"
      ? !yField
        ? "count"
        : yAggregate ??
          (kind === "line" || kind === "area" || kind === "dumbbell"
            ? defaultLineAreaAggregate(yField, columns)
            : "sum")
      : undefined;

  if (kind === "line" || kind === "area") {
    const bits = [subtitle].filter(Boolean);
    if (rollingWindow) bits.push(`${rollingWindow}-pt rolling mean`);
    if (seriesNormalize === "index100") bits.push("indexed to 100");
    if (seriesNormalize === "zscore") bits.push("z-scored series");
    if (yScale && yScale !== "linear") bits.push(`${yScale} Y`);
    if (anomalyHighlight) bits.push("anomaly rings");
    if (comparePrevious) bits.push("vs earlier half");
    if (timeBit) bits.push(timeBit);
    subtitle = bits.filter(Boolean).join(" · ") || subtitle;
  } else if (timeBit) {
    subtitle = subtitle ? `${subtitle} · ${timeBit}` : timeBit;
  }

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
    shapeField: shapeField ?? undefined,
    emojiField: emojiField ?? undefined,
    emojiMap,
    yAggregate: effectiveYAggregate ?? undefined,
    topN: topN ?? undefined,
    y2Field: y2Field ?? undefined,
    comparePrevious: comparePrevious || undefined,
    barStackMode: kind === "bar" && barFacetId ? barStackMode : undefined,
    rollingWindow: (kind === "line" || kind === "area") && rollingWindow ? rollingWindow : undefined,
    yScale: yScale && yScale !== "linear" ? yScale : undefined,
    seriesNormalize: (kind === "line" || kind === "area") && seriesNormalize ? seriesNormalize : undefined,
    residualOverlay: residualOverlay || undefined,
    anomalyHighlight: anomalyHighlight || undefined,
    bumpMode: bumpMode || undefined,
    deltaDisplay:
      kind === "dumbbell" && deltaDisplay && deltaDisplay !== "off" ? deltaDisplay : undefined,
    timeWindowField: timeWindowField || undefined,
    timeWindow: timeWindow || undefined,
    tooltipFields: extra?.tooltipFields,
    tooltipKeyField: extra?.tooltipKeyField,
    layoutDirection: layoutDirection || undefined,
  };
}
