// =================================================================
// Curated chart stories for the Wikipedia stream and every poll source kind.
// (split from recommendations.ts — LOOM-195; public API re-exported there)
// =================================================================

import { type ChartTimeRange } from "../chartTime";
import { inferType, measureColumns, nominalQualityBoost, stableLiveChartId, yFieldSupportsLogScale } from "./columns";
import { createChartRec, fitEncodingToKind } from "./createChartRec";
import { expandRecommendationsWithExtras } from "./expand";
import { type ColumnInfo, type QueryResult } from "../queryTypes";
import { chartKindDataSupport, getRandomEncoding } from "./random";
import { type StorySequence, recommend } from "./recommend";
import { type SourceKind } from "../sourceRegistry";
import { CHART_KIND_OPTIONS, type ChartKind, type ChartRecommendation, type YAggregateOption } from "./types";
import { enumerateDiscoverCharts } from "../discoverCandidates";
import { isGeoRegionField } from "../geoFields";

/** Dual-measure compares — always try to keep these in short discover windows. */
export const CORE_COMPARE_KINDS: readonly ChartKind[] = ["pyramid", "dumbbell", "slope"];

/** Broader “interesting compare” set for discover prioritization. */
export const COMPARE_KIND_PRIORITY = new Set<ChartKind>([
  ...CORE_COMPARE_KINDS,
  "bump",
  "waterfall",
  "pareto",
  "corrMatrix",
  "scatter",
]);

/**
 * Deterministic category + two measures for pyramid / slope / dumbbell fills.
 * Avoids Math.random so What’s interesting stays stable across reopen.
 */
export function pickBestCompareEncoding(
  columns: ColumnInfo[],
  kind: "pyramid" | "dumbbell" | "slope",
): { xField: string; yField: string; sizeField: string } | null {
  const nums = measureColumns(columns);
  if (nums.length < 2) return null;
  const hi = kind === "dumbbell" ? 24 : 20;
  const cats = columns
    .filter((c) => {
      const t = inferType(c.data_type, c.name, c.min_value, c.max_value);
      return t === "nominal" && c.distinct_count >= 2 && c.distinct_count <= hi;
    })
    .sort(
      (a, b) =>
        nominalQualityBoost(b.name) - nominalQualityBoost(a.name) ||
        a.distinct_count - b.distinct_count ||
        a.name.localeCompare(b.name),
    );
  const cat = cats[0];
  if (!cat) return null;
  const [left, right] = [...nums].sort((a, b) => a.name.localeCompare(b.name));
  if (!left || !right) return null;
  return { xField: cat.name, yField: left.name, sizeField: right.name };
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
  opts?: { discoverProbe?: boolean },
): StorySequence {
  const colNames = new Set(columns.map((c) => c.name));
  const hasTs = colNames.has("ts");
  const hasWiki = colNames.has("wiki");
  const hasBot = colNames.has("bot");
  const hasNamespace = colNames.has("namespace");
  const hasDelta = colNames.has("delta");
  const hasEditType = colNames.has("edit_type");

  const charts: ChartRecommendation[] = [];

  const mkRec = (
    kind: ChartKind,
    title: string,
    subtitle: string,
    score: number,
    xField: string,
    yField: string | null,
    colorField: string | null,
    yAggregate?: YAggregateOption | null,
    extraEnc?: {
      rowField?: string | null;
      topN?: number | null;
      y2Field?: string | null;
      comparePrevious?: boolean | null;
      timeWindowField?: string | null;
      timeWindow?: ChartTimeRange | null;
    },
  ): ChartRecommendation => ({
    id: stableLiveChartId(
      "stream-wiki",
      kind,
      xField,
      yField,
      colorField,
      [
        yAggregate ?? "",
        extraEnc?.rowField ?? "",
        extraEnc?.topN ?? "",
        extraEnc?.comparePrevious ? "prev" : "",
        extraEnc?.timeWindow ?? "",
      ].join("-"),
    ),
    kind,
    title,
    subtitle,
    score,
    spec: {},
    xField,
    yField,
    colorField,
    yAggregate: yAggregate ?? null,
    rowField: extraEnc?.rowField ?? undefined,
    topN: extraEnc?.topN ?? undefined,
    y2Field: extraEnc?.y2Field ?? undefined,
    comparePrevious: extraEnc?.comparePrevious || undefined,
    timeWindowField: extraEnc?.timeWindow && extraEnc.timeWindow !== "all" ? (extraEnc.timeWindowField ?? undefined) : undefined,
    timeWindow: extraEnc?.timeWindow && extraEnc.timeWindow !== "all" ? extraEnc.timeWindow : undefined,
  });

  if (hasTs) {
    charts.push(mkRec("line", "Edits over time", "Event rate trend — the pulse of Wikipedia", 95, "ts", null, null, "count"));
    charts.push(mkRec("line", "Edits vs earlier half", "Recent pulse vs the first half of the buffer", 91, "ts", null, null, "count", { comparePrevious: true }));
  }
  if (hasWiki) {
    charts.push(mkRec("bar", "Edits by wiki", "Which language editions are most active", 90, "wiki", null, null, "count", { topN: 15 }));
    if (hasTs) {
      charts.push(mkRec("bar", "Edits by wiki · last hour", "Who is busiest right now", 89, "wiki", null, null, "count", {
        topN: 12,
        timeWindowField: "ts",
        timeWindow: "1h",
      }));
    }
  }
  if (hasTs && hasWiki) {
    charts.push(mkRec("line", "Edits faceted by wiki", "One panel per language edition", 88, "ts", null, null, "count", { rowField: "wiki" }));
  }
  if (hasBot && hasWiki) {
    charts.push(mkRec("bar", "Bot vs Human", "Automated edits vs manual contributions", 86, "bot", null, "wiki", "count"));
  }
  if (hasDelta) {
    charts.push(mkRec("histogram", "Edit size distribution", "How big are typical edits (bytes delta)", 84, "delta", null, null));
  }
  if (hasNamespace && hasDelta) {
    charts.push(mkRec("bar", "Impact by namespace", "Average edit size per namespace", 82, "namespace", "delta", null, "mean", { topN: 12 }));
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

  const auto = opts?.discoverProbe ? [] : recommend(columns, data, "Wikipedia Live");
  return {
    title: "Wikipedia Live: Real-time edit analytics",
    charts: opts?.discoverProbe ? enumerateDiscoverCharts(columns, charts, "wiki", data) : mergeStoryCharts(charts, auto, columns, "wiki", 96),
  };
}

/**
 * Merge curated + auto charts, keeping curated order and ensuring every
 * schema-supported ChartKind gets at least one slot when possible.
 */
export function mergeStoryCharts(
  curated: ChartRecommendation[],
  auto: ChartRecommendation[],
  columns: ColumnInfo[],
  tableName: string,
  limit = 96,
): ChartRecommendation[] {
  const expanded = expandRecommendationsWithExtras(curated, columns);
  const curatedIds = new Set(curated.map((c) => c.id));
  const extras = expanded.filter((c) => !curatedIds.has(c.id));

  const keyOf = (r: ChartRecommendation) =>
    [
      r.kind,
      r.xField,
      r.yField ?? "",
      r.colorField ?? "",
      r.rowField ?? "",
      r.topN ?? "",
      r.y2Field ?? "",
      r.barStackMode ?? "",
      r.rollingWindow ?? "",
      r.yScale ?? "",
      r.seriesNormalize ?? "",
      r.residualOverlay ? "1" : "",
      r.anomalyHighlight ? "1" : "",
      r.bumpMode ?? "",
      r.wordCloudMode ?? "",
      r.pyramidScaleMode ?? "",
      r.deltaDisplay ?? "",
      r.comparePrevious ? "1" : "",
      r.timeWindowField ?? "",
      r.timeWindow ?? "",
    ].join("|");
  const seen = new Set([...curated, ...extras].map(keyOf));
  const presentKinds = new Set([...curated, ...extras].map((c) => c.kind));

  const autoDeduped = auto
    .filter((r) => {
      const k = keyOf(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => ({ ...r, score: Math.min(r.score, 70), id: `${tableName}-auto-${r.id}` }));

  // Prefer auto charts that introduce a new kind first
  const kindBoost = autoDeduped.filter((r) => !presentKinds.has(r.kind));
  for (const r of kindBoost) presentKinds.add(r.kind);
  const kindRest = autoDeduped.filter((r) => !kindBoost.includes(r));

  // Dual-measure / compare kinds first so What’s interesting isn’t all bars + maps
  // when the chartLimit is small (discover probe / phone).
  const kindOrder = [
    ...CORE_COMPARE_KINDS.map((value) => ({ value })),
    ...CHART_KIND_OPTIONS.filter(
      (o) => COMPARE_KIND_PRIORITY.has(o.value) && !CORE_COMPARE_KINDS.includes(o.value),
    ),
    ...CHART_KIND_OPTIONS.filter((o) => !COMPARE_KIND_PRIORITY.has(o.value)),
  ];

  // Fill any remaining supported kinds the auto rail still missed
  const missingCompare: ChartRecommendation[] = [];
  const missingOther: ChartRecommendation[] = [];
  for (const { value: kind } of kindOrder) {
    if (presentKinds.has(kind)) continue;
    if (!chartKindDataSupport(columns, kind).ok) continue;
    const dual =
      kind === "pyramid" || kind === "dumbbell" || kind === "slope"
        ? pickBestCompareEncoding(columns, kind)
        : null;
    const enc = dual
      ? {
          xField: dual.xField,
          yField: dual.yField,
          colorField: null as string | null,
          sizeField: dual.sizeField,
          topN: 14 as number | null,
          pyramidScaleMode: "auto" as const,
          bumpMode: null,
          comparePrevious: null,
          y2Field: null,
        }
      : getRandomEncoding(columns, kind);
    if (!enc) continue;
    const rec = createChartRec(kind, columns, enc.xField, enc.yField, enc.colorField, tableName, {
      sizeField: enc.sizeField ?? null,
      topN: enc.topN ?? (kind === "pyramid" || kind === "dumbbell" ? 14 : null),
      yAggregate: kind === "dumbbell" || kind === "pyramid" || kind === "slope" ? "sum" : null,
      pyramidScaleMode: kind === "pyramid" ? (enc.pyramidScaleMode ?? "auto") : null,
      deltaDisplay:
        kind === "pyramid" || kind === "slope" || kind === "dumbbell"
          ? "diff"
          : null,
      bumpMode: kind === "bump" ? (enc.bumpMode ?? "rank") : null,
      comparePrevious: enc.comparePrevious ?? null,
      y2Field: enc.y2Field ?? null,
    });
    if (!rec) continue;
    const filled = {
      ...rec,
      score: Math.min(rec.score, COMPARE_KIND_PRIORITY.has(kind) ? 68 : 66),
      id: `${tableName}-kind-${kind}`,
    };
    if (COMPARE_KIND_PRIORITY.has(kind)) missingCompare.push(filled);
    else missingOther.push(filled);
    presentKinds.add(kind);
  }

  // Curated → compare-kind fills → expand variants → other fills → auto.
  // Keeps mirror/dumbbell/slope/Δ visible even when discover caps variants per source.
  const merged = [
    ...curated,
    ...missingCompare,
    ...extras,
    ...kindBoost,
    ...missingOther,
    ...kindRest,
  ];
  return ensureCompareKindsInWindow(merged, limit, COMPARE_KIND_PRIORITY);
}

/**
 * When discover/mobile truncates the rail, pull one chart per priority kind
 * forward so pyramid / dumbbell / slope / etc. aren't buried past the cap.
 * Core dual-measure kinds are promoted before Pareto / scatter.
 */
export function ensureCompareKindsInWindow(
  charts: ChartRecommendation[],
  limit: number,
  priority: Set<ChartKind> = COMPARE_KIND_PRIORITY,
): ChartRecommendation[] {
  if (charts.length <= limit) return charts;

  const selected: ChartRecommendation[] = [];
  const selectedIds = new Set<string>();
  const kindsIn = new Set<ChartKind>();

  // Half the window for compares — enough for pyramid + dumbbell + slope + a couple extras.
  const reserve = Math.min(priority.size, Math.max(3, Math.ceil(limit / 2)));
  const primaryBudget = Math.max(1, limit - reserve);

  for (const c of charts) {
    if (selected.length >= primaryBudget) break;
    selected.push(c);
    selectedIds.add(c.id);
    kindsIn.add(c.kind);
  }

  const promoteOrder = [
    ...CORE_COMPARE_KINDS,
    ...[...priority].filter((k) => !CORE_COMPARE_KINDS.includes(k)),
  ];
  for (const kind of promoteOrder) {
    if (selected.length >= limit) break;
    if (kindsIn.has(kind)) continue;
    const hit = charts.find((c) => c.kind === kind && !selectedIds.has(c.id));
    if (!hit) continue;
    selected.push(hit);
    selectedIds.add(hit.id);
    kindsIn.add(kind);
  }

  for (const c of charts) {
    if (selected.length >= limit) break;
    if (selectedIds.has(c.id)) continue;
    selected.push(c);
    selectedIds.add(c.id);
  }

  return selected;
}

export function guardCuratedChart(rec: ChartRecommendation, columns: ColumnInfo[]): ChartRecommendation {
  const fitted = fitEncodingToKind(rec.kind, columns, {
    xField: rec.xField,
    yField: rec.yField,
    colorField: rec.colorField ?? null,
  });
  // A time window on the X column bounds the bars ("jobs added, last 12 months" is 13 months,
  // not 443) — the whole-table distinct count would otherwise swap X for some category.
  if (rec.timeWindow && rec.timeWindow !== "all" && rec.timeWindowField === rec.xField && columns.some((c) => c.name === rec.xField)) {
    fitted.xField = rec.xField;
  }
  // US states (52 with DC + PR) are a standard ranking axis, past the generic 40-category cap;
  // as series (bump, small multiples) they're bounded by the chart's own top N.
  const stateLike = (name: string | null | undefined) => {
    const c = name ? columns.find((col) => col.name === name) : undefined;
    return !!c && isGeoRegionField(c.name) && c.distinct_count <= 60;
  };
  if (fitted.xField !== rec.xField && stateLike(rec.xField)) {
    if (fitted.colorField === null && rec.colorField && fitted.xField === rec.colorField) fitted.colorField = rec.colorField;
    fitted.xField = rec.xField;
  }
  // A series color the author bounded with top N (states, budget lines) stays, even past 12 groups.
  const bounded = (name: string | null | undefined) => {
    const c = name ? columns.find((col) => col.name === name) : undefined;
    return !!c && rec.topN != null && c.distinct_count <= 60;
  };
  if (fitted.colorField !== (rec.colorField ?? null) && bounded(rec.colorField)) {
    fitted.colorField = rec.colorField ?? null;
    if (fitted.xField !== rec.xField && columns.some((c) => c.name === rec.xField)) fitted.xField = rec.xField;
  }
  let topN = rec.topN;
  let rowField = rec.rowField;
  for (const field of [fitted.colorField, rowField ?? null]) {
    if (!field) continue;
    const c = columns.find((col) => col.name === field);
    if (c && c.distinct_count > 12 && topN == null) topN = 12;
  }
  if (rowField) {
    const c = columns.find((col) => col.name === rowField);
    if (c && c.distinct_count > 12) rowField = undefined;
  }
  return { ...rec, ...fitted, topN, rowField };
}

export interface RecommendSourceStoryOptions {
  /** Full catalog consideration; the discovery ranker caps qualified results. */
  discoverProbe?: boolean;
  chartLimit?: number;
}

/**
 * Chart recommendations for poll-based sources (USGS, Open-Meteo, NWS, World Bank).
 */
export function recommendSourceStory(
  kind: SourceKind,
  columns: ColumnInfo[],
  data: QueryResult | null,
  opts?: RecommendSourceStoryOptions,
): StorySequence {
  const mk = (
    k: ChartKind, title: string, subtitle: string, score: number,
    xField: string, yField: string | null, colorField: string | null,
    yAgg?: YAggregateOption | null,
    sizeField?: string | null,
    extraEnc?: {
      zField?: string | null;
      timeField?: string | null;
      trailId?: string | null;
      rowField?: string | null;
      topN?: number | null;
      y2Field?: string | null;
      comparePrevious?: boolean | null;
      barStackMode?: "grouped" | "stacked" | "percent" | null;
      rollingWindow?: 7 | 30 | null;
      yScale?: "linear" | "log" | "symlog" | null;
      seriesNormalize?: "index100" | "zscore" | null;
      residualOverlay?: boolean | null;
      anomalyHighlight?: boolean | null;
      bumpMode?: "rank" | "delta" | null;
      pyramidScaleMode?: "auto" | "shared" | "independent" | null;
      deltaDisplay?: "off" | "diff" | "pct" | null;
      timeWindowField?: string | null;
      timeWindow?: ChartTimeRange | null;
      analysisPreset?: ChartRecommendation["analysisPreset"];
    },
  ): ChartRecommendation => ({
    id: stableLiveChartId(
      kind,
      k,
      xField,
      yField,
      colorField,
      [
        title,
        yAgg ?? "",
        sizeField ?? "",
        extraEnc?.barStackMode ?? "",
        extraEnc?.yScale ?? "",
        extraEnc?.comparePrevious ? "prev" : "",
        extraEnc?.timeWindow ?? "",
      ].join("-"),
    ),
    kind: k,
    title,
    subtitle,
    score,
    spec: {},
    xField,
    yField,
    colorField,
    yAggregate: yAgg ?? null,
    sizeField: sizeField ?? undefined,
    zField: extraEnc?.zField ?? undefined,
    timeField: extraEnc?.timeField ?? undefined,
    trailId: extraEnc?.trailId ?? undefined,
    rowField: extraEnc?.rowField ?? undefined,
    topN: extraEnc?.topN ?? undefined,
    y2Field: extraEnc?.y2Field ?? undefined,
    comparePrevious: extraEnc?.comparePrevious || undefined,
    barStackMode: k === "bar" && colorField ? (extraEnc?.barStackMode ?? "grouped") : undefined,
    rollingWindow: (k === "line" || k === "area") && extraEnc?.rollingWindow ? extraEnc.rollingWindow : undefined,
    yScale:
      extraEnc?.yScale && extraEnc.yScale !== "linear"
        ? extraEnc.yScale === "log" && !yFieldSupportsLogScale(yField, columns)
          ? "symlog"
          : extraEnc.yScale
        : undefined,
    seriesNormalize: (k === "line" || k === "area") && extraEnc?.seriesNormalize ? extraEnc.seriesNormalize : undefined,
    residualOverlay: extraEnc?.residualOverlay || undefined,
    anomalyHighlight: extraEnc?.anomalyHighlight || undefined,
    bumpMode: k === "bump" && extraEnc?.bumpMode ? extraEnc.bumpMode : undefined,
    pyramidScaleMode: k === "pyramid" ? (extraEnc?.pyramidScaleMode ?? "auto") : undefined,
    deltaDisplay:
      (k === "pyramid" || k === "slope" || k === "dumbbell") &&
      extraEnc?.deltaDisplay &&
      extraEnc.deltaDisplay !== "off"
        ? extraEnc.deltaDisplay
        : undefined,
    timeWindowField:
      extraEnc?.timeWindow && extraEnc.timeWindow !== "all"
        ? (extraEnc.timeWindowField ?? undefined)
        : undefined,
    timeWindow: extraEnc?.timeWindow && extraEnc.timeWindow !== "all" ? extraEnc.timeWindow : undefined,
    analysisPreset: extraEnc?.analysisPreset ?? undefined,
  });

  /** Curated first, then Facet/TopN/Compare, then full-schema recommend() (network, odd, …). */
  const finish = (title: string, charts: ChartRecommendation[]): StorySequence => {
    const guarded = charts.map((c) => guardCuratedChart(c, columns));
    if (opts?.discoverProbe) return { title, charts: ensureCompareKindsInWindow(enumerateDiscoverCharts(columns, guarded, kind, data), opts.chartLimit ?? 10_000) };
    const limit = opts?.discoverProbe ? opts.chartLimit ?? 8 : 96;
    const auto = opts?.discoverProbe ? [] : recommend(columns, data, kind);
    return {
      title,
      charts: mergeStoryCharts(guarded, auto, columns, kind, limit),
    };
  };

  if (kind === "usgs") {
    return finish("Earthquake Analytics", [
        mk("geoPoints", "Quake map", "Projected locations on coastlines", 98, "longitude", "latitude", "mag_type", null, "magnitude"),
        mk("geoPoints", "Quakes · last 6 hours", "Only the newest shakes on the map", 97, "longitude", "latitude", "mag_type", null, "magnitude", {
          timeWindowField: "ts",
          timeWindow: "6h",
        }),
        mk("geoHex", "Quake hex density", "Where energy piles up on the map", 96, "longitude", "latitude", "mag_type"),
        mk("globe", "Quake globe", "Spin the planet — quakes as points", 95, "longitude", "latitude", "mag_type", null, "magnitude"),
        mk("scatter3d", "Orbit depth cloud", "Lat · lon · depth — drag to orbit", 94, "longitude", "latitude", "mag_type", null, "magnitude", { zField: "depth" }),
        mk("quakeTerrain", "Magnitude terrain", "Heightfield where energy piles up", 92, "longitude", "latitude", "mag_type", null, "magnitude", { zField: "magnitude" }),
        mk("firefly", "Firefly aftershocks", "Soft glow by magnitude", 88, "longitude", "latitude", "mag_type", null, "magnitude", { timeField: "ts" }),
      ]);
  }

  if (kind === "meteo") {
    return finish("World Weather Comparison", [
        mk("geoBubbles", "City climate map", "Twelve cities sized by temperature", 96, "longitude", "latitude", "city", null, "temperature"),
        mk("pyramid", "Temp ↔ humidity", "Mirror climate by city · same-scale lengths", 95, "city", "temperature", null, "mean", "humidity", {
          pyramidScaleMode: "shared",
          deltaDisplay: "diff",
        }),
        mk("dumbbell", "Temp → humidity", "Start/end climate pair · Δ labeled", 94, "city", "temperature", null, "mean", "humidity", {
          deltaDisplay: "diff",
        }),
        mk("slope", "Temp → humidity", "Lean diagonal of comfort · Δ labeled", 93, "city", "temperature", null, null, "humidity", {
          deltaDisplay: "diff",
        }),
        mk("line", "Temperature over time", "How does temperature vary across cities?", 91, "ts", "temperature", "city"),
        mk("line", "Temp · 7-pt rolling", "Smoothing the noise across cities", 90, "ts", "temperature", "city", "mean", null, { rollingWindow: 7 }),
        mk("line", "Temp indexed to 100", "Fair compare — every city starts at 100", 88, "ts", "temperature", "city", "mean", null, { seriesNormalize: "index100" }),
        mk("line", "Temp facets by city", "One panel per city", 86, "ts", "temperature", null, "mean", null, { rowField: "city" }),
        mk("line", "Temp vs humidity", "Compare two measures over time", 84, "ts", "temperature", "city", "mean", null, { y2Field: "humidity" }),
        mk("corrMatrix", "Climate correlations", "Temp · humidity · wind · pressure", 82, "temperature", "humidity", null),
        mk("stream", "Temp streams by city", "Organic stacked climate flow", 80, "ts", "temperature", "city"),
        mk("beeswarm", "Temp swarm by city", "Every reading as a dot", 78, "city", "temperature", null),
      ]);
  }

  if (kind === "nws") {
    return finish("US Weather Alert Analytics", [
        mk("bar", "Alerts by event type", "What kinds of alerts are most common?", 95, "event", null, null, "count", null, { topN: 15 }),
        mk("bar", "Severity × urgency", "Stacked severity, split by urgency", 93, "severity", null, "urgency", "count", null, { barStackMode: "stacked" }),
        mk("bar", "Event mix (100%)", "Share of urgency within each event", 91, "event", null, "urgency", "count", null, { topN: 12, barStackMode: "percent" }),
        mk("bar", "Alerts by severity", "Distribution of severity levels", 90, "severity", null, null, "count"),
        mk("bucketField", "Severity paddocks", "Alert dots bucketed by severity", 88, "severity", null, "urgency"),
        mk("pie", "Urgency breakdown", "How urgent are current alerts?", 85, "urgency", null, null, "count"),
        mk("bar", "Top alert sources", "Which NWS offices issue most alerts?", 80, "sender_name", null, null, "count", null, { topN: 12 }),
        mk("bar", "Certainty levels", "How certain are the alerts?", 75, "certainty", null, "severity", "count", null, { barStackMode: "grouped" }),
      ]);
  }

  if (kind === "world_bank") {
    return finish("Global development", [
        mk("choropleth", "Life expectancy map", "Average years of life by country", 96, "country_code", "life_expectancy", null, "mean"),
        mk("pyramid", "GDP ↔ life expectancy", "Mirror wealth and health by country · Δ labeled", 95, "country_name", "gdp_per_capita", null, "mean", "life_expectancy", {
          topN: 14,
          pyramidScaleMode: "auto",
          deltaDisplay: "diff",
        }),
        mk("dumbbell", "Wealth → health", "GDP per person to life expectancy · Δ labeled", 94, "country_name", "gdp_per_capita", null, "mean", "life_expectancy", {
          topN: 20,
          deltaDisplay: "diff",
        }),
        mk("slope", "GDP → life", "Lean diagonal of development · Δ labeled", 93, "country_name", "gdp_per_capita", null, null, "life_expectancy", {
          deltaDisplay: "diff",
        }),
        mk("bubble", "Wealth vs health", "GDP per person against life expectancy, sized by population", 92, "gdp_per_capita", "life_expectancy", null, null, "population"),
        mk("line", "Life expectancy over time", "Average across countries, 2000–2023", 90, "yr", "life_expectancy", null, "mean"),
        mk("line", "Life · 7-yr rolling", "Smoothed global average", 88, "yr", "life_expectancy", null, "mean", null, { rollingWindow: 7 }),
        mk("line", "Life vs GDP over time", "Two development measures compared", 86, "yr", "life_expectancy", null, "mean", null, { y2Field: "gdp_per_capita" }),
        mk("pareto", "Population Pareto", "Bars + cumulative share of people", 85, "country_name", "population", null, "max", null, { topN: 20 }),
        mk("corrMatrix", "Development correlations", "GDP · life · CO₂ · population", 84, "gdp_per_capita", "life_expectancy", null),
        mk("bar", "Most populous countries", "Peak population, 2000–2023", 82, "country_name", "population", null, "max", null, { topN: 15 }),
        mk("scatter", "CO₂ vs wealth", "Emissions per person against GDP per person", 80, "gdp_per_capita", "co2_per_capita", null),
        mk("scatter", "Wealth vs health · residuals", "Distance from the linear fit", 78, "gdp_per_capita", "life_expectancy", null, null, null, { residualOverlay: true }),
      ]);
  }

  if (kind === "iss") {
    return finish("ISS orbital track", [
        mk("globeTrail", "Orbit on the globe", "Great-circle path around the sphere", 98, "longitude", "latitude", null, null, "altitude_km", { timeField: "ts" }),
        mk("geoPoints", "Ground track map", "Projected path on coastlines", 96, "longitude", "latitude", null, null, "altitude_km", { timeField: "ts" }),
        mk("trailRibbon", "Orbital ribbons", "Path fades through recent samples", 94, "longitude", "latitude", null, null, "altitude_km", { timeField: "ts" }),
        mk("scatter3d", "Altitude cloud", "Lon · lat · altitude", 90, "longitude", "latitude", null, null, "velocity_kmh", { zField: "altitude_km", timeField: "ts" }),
        mk("line", "Altitude over time", "How high is the station?", 86, "ts", "altitude_km", null),
      ]);
  }

  if (kind === "hn") {
    return finish("Hacker News front page", [
        mk("bar", "Top stories by points", "What's hottest right now?", 95, "title", "points", null, "max", null, { topN: 15 }),
        mk("dumbbell", "Points → comments", "Engagement range per story · Δ labeled", 94, "title", "points", null, "mean", "num_comments", {
          topN: 20,
          deltaDisplay: "diff",
        }),
        mk("slope", "Points → comments", "Lean diagonal of discussion · Δ labeled", 93, "title", "points", null, null, "num_comments", {
          deltaDisplay: "diff",
        }),
        mk("pareto", "Points Pareto", "Which stories carry most of the points?", 91, "title", "points", null, "max", null, { topN: 20 }),
        mk("scatter", "Points vs comments", "Discussion intensity", 88, "points", "num_comments", "author"),
        mk("scatter", "Points vs comments · residuals", "Stories off the linear fit", 86, "points", "num_comments", null, null, null, { residualOverlay: true }),
        mk("scatter", "Points vs comments · facets", "One panel per author (top posters)", 84, "points", "num_comments", null, null, null, { rowField: "author" }),
        mk("histogram", "Score distribution", "How viral is the front page?", 80, "points", null, null),
        mk("bar", "Active authors", "Who is posting?", 76, "author", null, null, "count", null, { topN: 12 }),
      ]);
  }

  if (kind === "crypto") {
    return finish("Crypto markets", [
        mk("bar", "Market cap leaders", "The biggest coins by value", 95, "symbol", "market_cap", null, "max", null, { topN: 15 }),
        mk("pyramid", "Cap ↔ volume", "Mirror size and activity · Δ labeled", 94, "symbol", "market_cap", null, "sum", "volume_24h", {
          topN: 14,
          pyramidScaleMode: "auto",
          deltaDisplay: "pct",
        }),
        mk("dumbbell", "Cap → volume", "Start/end of liquidity · Δ labeled", 93, "symbol", "market_cap", null, "mean", "volume_24h", {
          topN: 20,
          deltaDisplay: "diff",
        }),
        mk("slope", "Cap → volume", "Lean diagonal of trading heat · Δ labeled", 92, "symbol", "market_cap", null, null, "volume_24h", {
          deltaDisplay: "diff",
        }),
        mk("pareto", "Market-cap Pareto", "Cumulative share of total value", 90, "symbol", "market_cap", null, "max", null, { topN: 20 }),
        mk("bar", "24h movers", "Who gained and lost the most today", 88, "symbol", "change_24h_pct", null, "max", null, { topN: 15 }),
        mk("scatter", "Cap vs change · log Y", "Magnitude on a log scale", 86, "market_cap", "change_24h_pct", null, null, null, { yScale: "log" }),
        mk("corrMatrix", "Market correlations", "Price · cap · volume · change", 84, "price_usd", "market_cap", null),
        mk("treemap", "Market share", "Each coin's slice of the top 50", 82, "symbol", "market_cap", null, "max", null, { topN: 20 }),
        mk("histogram", "Daily moves", "How far the top 50 coins moved in 24 hours", 80, "change_24h_pct", null, null),
        mk("isoScatter", "Price · change · volume", "Pseudo-3D market space", 78, "price_usd", "change_24h_pct", "symbol", null, "volume_24h"),
      ]);
  }

  if (kind === "aq") {
    return finish("City air quality", [
        mk("geoBubbles", "AQI on the map", "Cities as pollution bubbles", 96, "longitude", "latitude", "city", null, "pm2_5"),
        mk("pyramid", "PM2.5 ↔ ozone", "Mirror two pollutants by city · Δ labeled", 95, "city", "pm2_5", null, "sum", "ozone", {
          pyramidScaleMode: "auto",
          deltaDisplay: "diff",
        }),
        mk("dumbbell", "PM2.5 → AQI", "Particulate to European AQI · Δ labeled", 94, "city", "pm2_5", null, "mean", "european_aqi", {
          topN: 12,
          deltaDisplay: "diff",
        }),
        mk("slope", "PM2.5 → ozone", "Lean diagonal of co-pollutants · Δ labeled", 93, "city", "pm2_5", null, null, "ozone", {
          deltaDisplay: "diff",
        }),
        mk("bar", "PM2.5 by city", "Who is breathing the most fine particulate?", 91, "city", "pm2_5", null, "max", null, { topN: 12 }),
        mk("pareto", "PM2.5 Pareto", "Which cities drive most of the load?", 89, "city", "pm2_5", null, "max", null, { topN: 15 }),
        mk("bar", "European AQI", "Compare air quality index across cities", 86, "city", "european_aqi", null, "max", null, { topN: 12 }),
        mk("scatter", "PM2.5 vs ozone", "Do pollutants move together?", 84, "pm2_5", "ozone", "city"),
        mk("scatter", "PM2.5 vs ozone · residuals", "Cities off the linear fit", 82, "pm2_5", "ozone", "city", null, null, { residualOverlay: true }),
        mk("corrMatrix", "Pollutant correlations", "PM2.5 · ozone · NO₂ · AQI", 80, "pm2_5", "ozone", null),
        mk("bar", "NO₂ by city", "Traffic and combustion signal", 78, "city", "nitrogen_dioxide", null, "max", null, { topN: 12 }),
      ]);
  }

  if (kind === "fx") {
    return finish("Euro exchange rates", [
        mk("box", "Volatility by currency", "Spread of daily % moves over 90 days", 92, "quote", "change_pct", null),
        mk("line", "Daily moves by currency", "% change vs the euro, day to day", 95, "as_of", "change_pct", "quote", "mean"),
        mk("line", "Moves · 7-day rolling", "Smoothed % change by quote", 94, "as_of", "change_pct", "quote", "mean", null, { rollingWindow: 7 }),
        mk("line", "Z-scored moves", "Each currency on a common scale", 92, "as_of", "change_pct", "quote", "mean", null, { seriesNormalize: "zscore" }),
        mk("line", "Moves · anomaly rings", "Days that jump |z| > 2.5", 90, "as_of", "change_pct", "quote", "mean", null, { anomalyHighlight: true }),
        mk("line", "Moves faceted by currency", "One panel per quote", 88, "as_of", "change_pct", null, "mean", null, { rowField: "quote" }),
        mk("bar", "Average rate vs EUR", "Units per euro, 90-day average", 85, "quote", "rate", null, "mean"),
        mk("bar", "Rates vs earlier half", "Period-over-period ghost bars", 83, "quote", "rate", null, "mean", null, { comparePrevious: true }),
        mk("beeswarm", "Every daily move", "Each currency-day as a dot", 80, "quote", "change_pct", null),
      ]);
  }

  if (kind === "fema") {
    return finish("FEMA disaster declarations", [
        mk("choropleth", "Declarations by state", "US states filled by declaration count", 98, "state", null, null, "count"),
        mk("bar", "By incident type", "What kinds of disasters are declared?", 95, "incident_type", null, null, "count", null, { topN: 15 }),
        mk("bar", "Type × declaration", "Stacked incident mix by declaration kind", 93, "declaration_type", null, "incident_type", "count", null, { barStackMode: "stacked" }),
        mk("bar", "State mix (100%)", "Share of incident types within top states", 90, "state", null, "incident_type", "count", null, { topN: 12, barStackMode: "percent" }),
        mk("bucketField", "Type paddocks", "Declarations as dots in incident buckets", 86, "incident_type", null, "declaration_type"),
        mk("bar", "Declaration type", "Major disaster vs emergency", 82, "declaration_type", null, null, "count"),
        mk("histogram", "Fiscal year declared", "When were they declared?", 78, "fy_declared", null, null),
      ]);
  }

  if (kind === "opensky") {
    return finish("Aircraft over the US", [
        mk("geoPoints", "Sky map", "Projected positions on coastlines", 96, "longitude", "latitude", "origin_country", null, "baro_altitude"),
        mk("geoPoints", "Sky · last hour", "Craft with a last_contact in the past hour", 95, "longitude", "latitude", "origin_country", null, "baro_altitude", {
          timeWindowField: "ts",
          timeWindow: "1h",
        }),
        mk("globeTrail", "Flight globe", "Craft paths wrapped on the sphere", 98, "longitude", "latitude", "origin_country", null, "baro_altitude", { timeField: "ts", trailId: "icao24" }),
        mk("geoBubbles", "Altitude bubbles", "Sized by barometric altitude", 94, "longitude", "latitude", "origin_country", null, "baro_altitude"),
        mk("trailRibbon", "Flight ribbons", "Each craft leaves a fading trail", 92, "longitude", "latitude", "origin_country", null, "baro_altitude", { timeField: "ts", trailId: "icao24" }),
        mk("scatter3d", "Altitude orbit cloud", "Lon · lat · altitude — drag to orbit", 88, "longitude", "latitude", "origin_country", null, "velocity", { zField: "baro_altitude" }),
      ]);
  }

  if (kind === "countries") {
    return finish("World countries", [
        mk("choropleth", "Population map", "Countries filled by population", 98, "cca3", "population", "region", "max"),
        mk("pyramid", "Population ↔ area", "Mirror size by country · Auto scale · Δ labeled", 96, "name", "population", null, "sum", "area", {
          topN: 14,
          pyramidScaleMode: "auto",
          deltaDisplay: "diff",
        }),
        mk("dumbbell", "Population → density", "People to crowding · Δ labeled", 95, "name", "population", null, "mean", "density", {
          topN: 20,
          deltaDisplay: "diff",
        }),
        mk("slope", "Population → area", "Lean diagonal of land vs people · Δ labeled", 94, "name", "population", null, null, "area", {
          deltaDisplay: "diff",
        }),
        mk("bar", "Population leaders", "Most populous countries", 90, "name", "population", "region", "max", null, { topN: 15 }),
        mk("bucketField", "Regions as fields", "Countries as dots in regional paddocks", 86, "region", "population", "region", null, "area"),
        mk("glyphStar", "Country stars", "Multivariate star glyphs", 82, "name", "population", "area", null, "density"),
        mk("isoBars", "Isometric population", "Fake-3D country blocks", 80, "name", "population", "region", "max", null, { topN: 15 }),
        mk("waffle", "Region waffle", "Share of countries by region", 76, "region", null, null, "count"),
      ]);
  }

  if (kind === "spacex") {
    return finish("SpaceX launch history", [
        mk("bar", "Launches by rocket", "Stacked by outcome", 95, "rocket", null, "success", "count", null, { barStackMode: "stacked" }),
        mk("bar", "Rocket mix (100%)", "Success share within each vehicle", 92, "rocket", null, "success", "count", null, { barStackMode: "percent" }),
        mk("bar", "Rockets side by side", "Grouped outcome counts", 90, "rocket", null, "success", "count", null, { barStackMode: "grouped" }),
        mk("pie", "Success rate", "Share of missions that reached orbit", 88, "success", null, null, "count"),
        mk("bucketField", "Outcome paddocks", "Launches as dots in success buckets", 84, "success", null, "rocket"),
        mk("strip", "Launch timeline", "Every launch as a tick, by rocket", 82, "date_utc", "rocket", "success"),
      ]);
  }

  if (kind === "nyc311") {
    return finish("NYC 311 complaints", [
        mk("geoPoints", "Complaint map", "Tickets on a projected basemap", 98, "longitude", "latitude", "borough"),
        mk("geoPoints", "Complaints · last 7 days", "Only the newest tickets on the map", 96, "longitude", "latitude", "borough", null, null, {
          timeWindowField: "created_date",
          timeWindow: "7d",
        }),
        mk("geoHex", "Complaint density", "Hexbins of 311 heat", 96, "longitude", "latitude", "borough"),
        mk("bar", "Top complaint types", "What are New Yorkers reporting?", 92, "complaint_type", null, null, "count", null, { topN: 15 }),
        mk("bar", "Borough × type", "Stacked complaint mix by borough", 90, "borough", null, "complaint_type", "count", null, { topN: 8, barStackMode: "stacked" }),
        mk("bar", "Borough mix (100%)", "Share of types within each borough", 88, "borough", null, "complaint_type", "count", null, { topN: 8, barStackMode: "percent" }),
        mk("bucketField", "Borough paddocks", "Tickets as dots in borough fields", 86, "borough", null, "complaint_type"),
        mk("bar", "By agency", "Who responds?", 80, "agency", null, null, "count", null, { topN: 12 }),
      ]);
  }

  if (kind === "covid") {
    return finish("COVID-19 by country", [
        mk("choropleth", "Cases world map", "Countries filled by cumulative cases", 98, "country", "cases", "continent", "max"),
        mk("pyramid", "Cases ↔ deaths", "Mirror by country · Auto scale (separate when magnitudes diverge)", 96, "country", "cases", null, "sum", "deaths", {
          topN: 14,
          pyramidScaleMode: "auto",
          deltaDisplay: "diff",
        }),
        mk("dumbbell", "Cases → deaths range", "Start/end dots per country · Δ labeled", 95, "country", "cases", null, "mean", "deaths", {
          topN: 20,
          deltaDisplay: "diff",
        }),
        mk("slope", "Cases → deaths", "Lean diagonal of severity · Δ labeled", 94, "country", "cases_per_million", null, null, "deaths_per_million", {
          deltaDisplay: "diff",
        }),
        mk("pareto", "Cases Pareto", "Cumulative share of global cases", 93, "country", "cases", null, "max", null, { topN: 20 }),
        mk("corrMatrix", "COVID correlations", "Cases · deaths · per-million rates", 92, "cases", "deaths", null),
        mk("scatter", "Cases vs deaths · log Y", "Severity on a log scale", 90, "cases", "deaths", "continent", null, null, { yScale: "log" }),
        mk("bar", "Cases leaders", "Highest cumulative cases", 88, "country", "cases", "continent", "max", null, { topN: 15, barStackMode: "grouped" }),
        mk("pyramid", "Continent cases ↔ deaths", "Same-scale mirror so bar lengths compare", 86, "continent", "cases", null, "sum", "deaths", {
          pyramidScaleMode: "shared",
          deltaDisplay: "pct",
        }),
        mk("bar", "Continent totals", "Stacked cases by continent · top countries", 84, "continent", "cases", "country", "max", null, { topN: 8, barStackMode: "stacked" }),
        mk("bucketField", "Continent paddocks", "Countries as dots in continental fields", 82, "continent", "cases", "continent", null, "deaths"),
        mk("mosaic", "Continent × country share", "Joint composition", 80, "continent", "cases", "country", "sum"),
      ]);
  }

  if (kind === "launches") {
    return finish("Upcoming space launches", [
        mk("bar", "By agency", "Who is launching next?", 95, "agency", null, null, "count"),
        mk("bar", "By location", "Which pads are busiest?", 90, "location", null, null, "count"),
        mk("bar", "By rocket", "Vehicles on the schedule", 85, "rocket", null, null, "count"),
        mk("bar", "Status mix", "Go / Hold / TBD", 80, "status", null, null, "count"),
      ]);
  }

  if (kind === "eonet") {
    return finish("Natural events on Earth", [
        mk("geoPoints", "Active events map", "Wildfires, storms, and volcanoes NASA is tracking", 98, "longitude", "latitude", "category"),
        mk("bar", "Events by type", "What is burning, blowing, or erupting right now?", 94, "category", null, null, "count"),
        mk("globe", "Events on the globe", "Spin to see where nature is active", 92, "longitude", "latitude", "category"),
        mk("geoBubbles", "Events by size", "Bubble size from reported magnitude", 88, "longitude", "latitude", "category", null, "magnitude"),
        mk("bar", "Reporting sources", "Who reports these events?", 80, "source", null, null, "count"),
      ]);
  }

  if (kind === "citibike") {
    return finish("Citi Bike right now", [
        mk("geoPoints", "Bikes on the map", "Every dock, sized by bikes available", 98, "longitude", "latitude", null, null, "bikes_available"),
        mk("histogram", "How full are docks?", "Share of each dock filled with bikes", 94, "pct_full", null, null),
        mk("scatter", "Capacity vs bikes", "Big docks running empty or full", 90, "capacity", "bikes_available", null),
        mk("geoHex", "Dock density", "Where Citi Bike stations cluster", 86, "longitude", "latitude", null),
        mk("bar", "Most bikes now", "Docks with the most bikes available", 82, "name", "bikes_available", null, "max", null, { topN: 15 }),
      ]);
  }

  if (kind === "spaceweather") {
    return finish("Geomagnetic activity", [
        mk("line", "Kp index this week", "Kp 5+ is a geomagnetic storm — auroras farther from the poles", 98, "ts", "kp", null, "max"),
        mk("line", "Kp · 7-pt rolling", "Smoothed storminess", 96, "ts", "kp", null, "max", null, { rollingWindow: 7 }),
        mk("line", "Kp anomalies", "Ring the quiet-vs-storm outliers", 95, "ts", "kp", null, "max", null, { anomalyHighlight: true }),
        mk("line", "Kp vs earlier half", "Recent storminess against the first half of the week", 94, "ts", "kp", null, "max", null, { comparePrevious: true }),
        mk("bar", "Storm levels", "How many 3-hour periods hit each G level", 90, "storm_level", null, null, "count"),
        mk("area", "Kp over time", "Filled view of geomagnetic activity", 86, "ts", "kp", null, "max"),
      ]);
  }

  if (kind === "ukcarbon") {
    return finish("Britain's grid carbon", [
        mk("line", "Carbon intensity today", "Grams of CO₂ per kWh, every half hour (forecast)", 98, "ts", "forecast", null, "mean"),
        mk("line", "Forecast vs actual", "Two intensity series compared", 94, "ts", "forecast", null, "mean", null, { y2Field: "actual" }),
        mk("line", "Measured intensity", "Actual readings so far", 90, "ts", "actual", null, "mean"),
        mk("scatter", "Forecast vs actual scatter", "How good is the forecast?", 86, "forecast", "actual", null),
        mk("bar", "Intensity bands", "Half hours by carbon index", 82, "intensity_index", null, null, "count"),
      ]);
  }

  if (kind === "pageviews") {
    return finish("What the world read recently", [
        mk("bar", "Most-read articles", "Latest published Wikimedia day (often yesterday UTC)", 98, "article", "views", null, "max", null, { topN: 20 }),
        mk("treemap", "Attention map", "Each article sized by views", 92, "article", "views", null, "max", null, { topN: 20 }),
        mk("lollipop", "Top reads", "Views per article", 86, "article", "views", null, "max", null, { topN: 15 }),
      ]);
  }

  if (kind === "climate") {
    return finish("Global warming since 1880", [
        mk("line", "Warming by year", "Average land + ocean anomaly vs the 20th-century mean (°C)", 99, "year", "anomaly_c", null, "mean"),
        mk("line", "Warming vs earlier half", "Recent decades against the first half of the record", 96, "year", "anomaly_c", null, "mean", null, { comparePrevious: true }),
        mk("spiral", "Climate spiral", "Each turn is a year — watch it widen", 93, "ts", "anomaly_c", null),
        mk("line", "Every month since 1880", "Monthly anomaly (°C)", 88, "ts", "anomaly_c", null, "mean"),
        mk("box", "Spread by month", "Which months run warmest?", 82, "month", "anomaly_c", null),
      ]);
  }

  if (kind === "gdacs") {
    return finish("Disasters underway", [
        mk("geoBubbles", "Active disasters", "Sized by expected impact, colored by type", 98, "longitude", "latitude", "event_type", null, "alert_score"),
        mk("bar", "By disaster type", "What is happening most right now?", 94, "event_type", null, "alert_level", "count"),
        mk("bar", "By alert level", "Green / orange / red", 90, "alert_level", null, null, "count"),
        mk("bar", "Countries affected", "Where alerts are concentrated", 84, "country", null, null, "count", null, { topN: 15 }),
      ]);
  }

  if (kind === "buoys") {
    return finish("The ocean right now", [
        mk("geoBubbles", "Wave heights at sea", "Every buoy sized by significant wave height", 97, "longitude", "latitude", null, null, "wave_height_m"),
        mk("scatter", "Wind vs waves", "Do stronger winds mean bigger seas?", 92, "wind_speed_ms", "wave_height_m", null),
        mk("geoBubbles", "Sea temperature", "Buoys sized by water temperature", 88, "longitude", "latitude", null, null, "water_temp_c"),
        mk("histogram", "Water temperatures", "Distribution across stations (°C)", 82, "water_temp_c", null, null),
      ]);
  }

  if (kind === "mbta") {
    return finish("Boston transit, live", [
        mk("geoPoints", "Every vehicle now", "Buses, subway, light rail, and commuter rail", 98, "longitude", "latitude", "route_type"),
        mk("bar", "Busiest routes", "Vehicles running per route", 92, "route", null, "route_type", "count", null, { topN: 15 }),
        mk("bar", "By mode", "How the fleet splits right now", 88, "route_type", null, null, "count"),
        mk("histogram", "Speeds", "How fast vehicles are moving (mph)", 82, "speed_mph", null, null),
      ]);
  }

  if (kind === "aurora") {
    return finish("Aurora forecast", [
        mk("geoBubbles", "Aurora oval now", "Chance of aurora overhead in the next ~30 minutes", 98, "longitude", "latitude", null, null, "probability"),
        mk("globe", "Aurora on the globe", "Spin to the poles", 92, "longitude", "latitude", null, null, "probability"),
        mk("scatter", "Latitude vs chance", "How far from the poles it reaches", 86, "latitude", "probability", null),
      ]);
  }

  if (kind === "asteroids") {
    return finish("Asteroids passing Earth", [
        mk("bubble", "Close passes", "Distance (lunar distances) vs speed, sized by estimated diameter", 97, "distance_ld", "velocity_kms", null, null, "diameter_m"),
        mk("bar", "Biggest visitors", "Estimated diameter (m)", 92, "name", "diameter_m", null, "max"),
        mk("histogram", "How close?", "Miss distance in lunar distances", 86, "distance_ld", null, null),
        mk("scatter", "Size vs distance", "Big ones pass farther out", 80, "diameter_m", "distance_ld", null),
      ]);
  }

  if (kind === "steam") {
    return finish("What gamers are playing", [
        mk("bar", "Most-played games", "Current concurrent players (CCU) right now", 97, "name", "peak_players", null, "max", null, { topN: 15 }),
        mk("bubble", "Price vs reviews", "Sized by current CCU", 92, "price_usd", "positive_pct", null, null, "peak_players"),
        mk("histogram", "Review scores", "Share of positive reviews (%)", 86, "positive_pct", null, null),
        mk("bar", "Top developers", "Games in the top 100", 80, "developer", null, null, "count", null, { topN: 12 }),
      ]);
  }

  if (kind === "bitcoin") {
    return finish("Bitcoin, block by block", [
        mk("bar", "Who mined the latest blocks", "Blocks per mining pool", 96, "pool", null, null, "count", null, { topN: 12 }),
        mk("line", "Transactions per block", "Over the latest ~60 blocks", 93, "ts", "tx_count", null, "max"),
        mk("line", "Tx vs median fee", "Throughput compared with fee pressure", 90, "ts", "tx_count", null, "max", null, { y2Field: "median_fee_sat_vb" }),
        mk("line", "Median fee", "sat/vB paid to get into each block", 86, "ts", "median_fee_sat_vb", null, "max"),
        mk("scatter", "Transactions vs fees", "Busier blocks pay more?", 82, "tx_count", "total_fees_btc", "pool"),
      ]);
  }

  if (kind === "debt") {
    return finish("US national debt", [
        mk("line", "Total public debt", "Every business day since 1993 (US$)", 98, "record_date", "total_debt", null, "max"),
        mk("line", "Public vs intragovernmental", "Two ownership stacks compared", 94, "record_date", "held_by_public", null, "max", null, { y2Field: "intragovernmental" }),
        mk("line", "Held by the public", "Debt owned outside the federal government", 90, "record_date", "held_by_public", null, "max"),
        mk("line", "Intragovernmental", "Debt the government owes itself (trust funds)", 86, "record_date", "intragovernmental", null, "max"),
        mk("line", "Total vs earlier half", "Recent debt path against the first half of the series", 82, "record_date", "total_debt", null, "max", null, { comparePrevious: true }),
      ]);
  }

  if (isUsafactsKind(kind)) {
    return finish(...usafactsStory(kind, mk, data));
  }

  if (kind === "firms") {
    return finish("Active fires (VIIRS)", [
        mk("geoPoints", "Fire map", "Hotspots sized by fire radiative power", 98, "longitude", "latitude", "confidence", null, "frp"),
        mk("geoPoints", "Fires · last 6 hours", "Only the freshest hotspots", 96, "longitude", "latitude", "confidence", null, "frp", {
          timeWindowField: "acq_ts",
          timeWindow: "6h",
        }),
        mk("geoBubbles", "Fire power bubbles", "Bigger = more FRP", 94, "longitude", "latitude", "daynight", null, "frp"),
        mk("scatter", "Brightness vs power", "TI4 brightness against FRP", 88, "bright_ti4", "frp", "confidence"),
        mk("scatter", "Brightness · day/night facets", "Small multiples by day vs night", 84, "bright_ti4", "frp", "confidence", null, null, { rowField: "daynight" }),
        mk("bar", "By confidence", "How many high / nominal / low detections?", 80, "confidence", null, null, "count"),
      ]);
  }

  if (kind === "nwis") {
    return finish("US river gauges", [
        mk("line", "Discharge by site", "Cubic feet per second over the past 2 days", 98, "ts", "discharge_cfs", "site_name", "mean"),
        mk("line", "Discharge facets", "One panel per river", 95, "ts", "discharge_cfs", null, "mean", null, { rowField: "site_name" }),
        mk("line", "Discharge vs stage", "Flow compared with gage height", 92, "ts", "discharge_cfs", "site_name", "mean", null, { y2Field: "gage_height_ft" }),
        mk("geoBubbles", "Latest flow on the map", "Sites sized by recent discharge", 88, "longitude", "latitude", "site_name", null, "discharge_cfs"),
        mk("scatter", "Stage vs discharge", "How height tracks flow", 82, "gage_height_ft", "discharge_cfs", "site_name"),
      ]);
  }

  if (kind === "starlink") {
    return finish("Starlink constellation", [
        mk("scatter", "Inclination vs mean motion", "Orbital families in the fleet", 96, "inclination", "mean_motion", null),
        mk("histogram", "Inclination spread", "How tightly clustered are the planes?", 90, "inclination", null, null),
        mk("scatter", "Eccentricity vs mean motion", "Near-circular LEO shell", 86, "eccentricity", "mean_motion", null),
        mk("histogram", "Mean motion distribution", "Orbit rate spread across the fleet", 80, "mean_motion", null, null),
      ]);
  }

  if (kind === "lobsters") {
    return finish("Lobsters hottest", [
        mk("bar", "Top by score", "What's hottest right now?", 95, "title", "score", null, "max", null, { topN: 15 }),
        mk("scatter", "Score vs comments", "Discussion intensity", 90, "score", "comment_count", "author"),
        mk("scatter", "Score vs comments · facets", "Small multiples by author", 86, "score", "comment_count", null, null, null, { rowField: "author" }),
        mk("bar", "Active authors", "Who is posting?", 82, "author", null, null, "count", null, { topN: 12 }),
        mk("histogram", "Score distribution", "How viral is the front page?", 78, "score", null, null),
      ]);
  }

  if (kind === "fireballs") {
    return finish("Fireballs over Earth", [
        mk("geoBubbles", "Where they burst", "Each fireball sized by impact energy", 98, "longitude", "latitude", null, null, "impact_kt"),
        mk("bar", "Fireballs per year", "Detections since 1988", 94, "ts", null, null, "count", null),
        mk("scatter", "Speed vs altitude", "Fast entries burst higher?", 90, "velocity_kms", "altitude_km", null, null, "impact_kt"),
        mk("histogram", "Impact energy", "Most are well under a kiloton", 86, "impact_kt", null, null),
        mk("line", "Energy over time", "Kilotons per fireball, by date", 82, "ts", "impact_kt", null, "max"),
      ]);
  }

  if (kind === "satellites") {
    return finish("Satellites you can see", [
        mk("scatter", "Perigee vs apogee", "Circular orbits sit on the diagonal", 96, "perigee_km", "apogee_km", "object_type", null, null),
        mk("scatter", "Inclination vs period", "Orbital families", 93, "inclination", "period_min", "object_type"),
        mk("bar", "By object type", "Payloads vs rocket bodies", 88, "object_type", null, null, "count"),
        mk("histogram", "Launch year", "How old is the visible sky?", 84, "launch_year", null, null),
        mk("bar", "Highest apogees", "Most eccentric visible orbits", 80, "name", "apogee_km", "object_type", "max", null, { topN: 15 }),
      ]);
  }

  if (kind === "internet_outages") {
    return finish("Internet outages this week", [
        mk("bar", "Alerts by country", "Where connectivity dropped most often", 97, "country", null, "level", "count", null, { topN: 20, barStackMode: "stacked" }),
        mk("scatter", "Drop size over time", "Each alert: % below normal", 94, "ts", "drop_pct", "datasource", null, null),
        mk("bar", "Worst drops", "Deepest single-signal outage per country", 92, "country", "drop_pct", null, "max", null, { topN: 15 }),
        mk("bar", "Signal mix", "BGP, active probing, Google traffic", 86, "datasource", null, "level", "count", null, { barStackMode: "stacked" }),
        mk("line", "Alerts per day", "Global outage pressure", 82, "ts", null, null, "count", null),
      ]);
  }

  if (kind === "faa_delays") {
    return finish("US airport delays now", [
        mk("bar", "Longest delays", "Max delay by airport", 97, "airport", "max_delay_min", "status_type", "max", null, { topN: 20 }),
        mk("bar", "Problem types", "Ground stops, delays, closures", 92, "status_type", null, null, "count"),
        mk("bar", "Airports affected", "Status entries per airport", 86, "airport", null, "status_type", "count", null, { topN: 20, barStackMode: "stacked" }),
      ]);
  }

  if (kind === "lobbying") {
    return finish("Federal lobbying filings", [
        mk("bar", "Biggest clients", "Reported income or expenses", 96, "client", "amount_usd", null, "sum", null, { topN: 15 }),
        mk("bar", "Busiest firms", "Filings per registrant", 93, "registrant", null, null, "count", null, { topN: 15 }),
        mk("choropleth", "Clients by state", "Where lobbying clients are based", 90, "client_state", null, null, "count"),
        mk("bar", "Issues touched", "How many issue areas per filing", 84, "n_issues", null, null, "count"),
        mk("histogram", "Filing size", "Most filings are modest", 80, "amount_usd", null, null),
      ]);
  }

  if (kind === "fda_recalls") {
    return finish("FDA recalls", [
        mk("bar", "By product and class", "Class I = could cause serious harm", 97, "product_type", null, "classification", "count", null, { barStackMode: "stacked" }),
        mk("choropleth", "Recalling firms by state", "Where recalled products came from", 94, "state", null, null, "count"),
        mk("bar", "Top recalling firms", "Most recalls in the latest batch", 90, "firm", null, "product_type", "count", null, { topN: 15 }),
        mk("bar", "Recalls by week", "Reported recalls over time", 86, "report_date", null, "product_type", "count", null, { barStackMode: "stacked" }),
        mk("bar", "Status", "Ongoing vs completed", 80, "status", null, null, "count"),
      ]);
  }

  if (kind === "vehicle_recalls") {
    return finish("Vehicle recalls", [
        mk("bar", "Vehicles affected by maker", "Total units in recent recalls", 97, "manufacturer", "potentially_affected", null, "sum", null, { topN: 15 }),
        mk("bar", "By component", "What keeps failing", 93, "component", null, null, "count", null, { topN: 15 }),
        mk("bar", "Recalls per week", "Filed with NHTSA", 88, "report_date", null, "recall_type", "count", null, { barStackMode: "stacked" }),
        mk("histogram", "Recall size", "Units per recall", 82, "potentially_affected", null, null),
      ]);
  }

  if (kind === "arxiv") {
    return finish("New arXiv papers", [
        mk("bar", "Papers by category", "Primary category of the newest preprints", 95, "primary_category", null, "field", "count", null, { topN: 20 }),
        mk("box", "Team size by field", "Authors per paper", 92, "field", "n_authors", null),
        mk("bar", "Papers per hour", "When submissions land", 88, "published", null, "field", "count", null, { barStackMode: "stacked" }),
        mk("scatter", "Authors vs cross-lists", "Big teams span more categories?", 84, "n_authors", "n_categories", "field"),
      ]);
  }

  if (kind === "github_events") {
    return finish("GitHub right now", [
        mk("bar", "Event mix", "Pushes, PRs, stars, forks", 96, "event_type", null, null, "count"),
        mk("bar", "Busiest repos", "Most events in the sample", 90, "repo", null, "event_type", "count", null, { topN: 15, barStackMode: "stacked" }),
        mk("line", "Events per minute", "Rolling sample of the public timeline", 86, "ts", null, "event_type", "count", null),
        mk("bar", "Org vs personal", "Who owns the active repos", 80, "is_org", null, "event_type", "count", null, { barStackMode: "percent" }),
      ]);
  }

  if (kind === "books") {
    return finish("Trending books", [
        mk("bar", "Open Library today", "Most-read books, ranked", 95, "title", "editions", "site", "max", null, { topN: 20 }),
        mk("bar", "Gutenberg downloads", "Most-downloaded public-domain books", 93, "title", "downloads", null, "max", null, { topN: 20 }),
        mk("histogram", "First published", "Classics vs new releases", 88, "first_year", null, null),
        mk("bar", "Authors on the lists", "Who shows up most", 82, "author", null, "site", "count", null, { topN: 15 }),
      ]);
  }

  if (kind === "nyc_inspections") {
    return finish("NYC restaurant inspections", [
        mk("geoPoints", "Inspections on the map", "Sized by inspection score (higher = worse)", 97, "longitude", "latitude", "grade", null, "score"),
        mk("bar", "Grades by borough", "A / B / C mix", 94, "borough", null, "grade", "count", null, { barStackMode: "percent" }),
        mk("box", "Scores by cuisine", "Spread of inspection scores", 90, "cuisine", "score", null),
        mk("bar", "Common violations", "Most frequent violation codes", 86, "violation_code", null, "critical", "count", null, { topN: 15 }),
        mk("histogram", "Score distribution", "0–13 is an A", 80, "score", null, null),
      ]);
  }

  if (kind === "chicago_crime") {
    return finish("Chicago crime reports", [
        mk("geoPoints", "Reports on the map", "Block-level locations by offense", 97, "longitude", "latitude", "primary_type", null, null),
        mk("bar", "By offense", "Most reported types", 94, "primary_type", null, "arrest", "count", null, { topN: 15, barStackMode: "stacked" }),
        mk("line", "Reports per hour", "Chicago local time", 88, "ts", null, null, "count", null),
        mk("bar", "By district", "Police district totals", 84, "district", null, null, "count"),
        mk("geoHex", "Hot spots", "Where reports cluster", 82, "longitude", "latitude", null),
      ]);
  }

  if (kind === "nyc_parking") {
    return finish("NYC parking tickets", [
        mk("bar", "Top violations", "Most common tickets", 96, "violation", null, null, "count", null, { topN: 15 }),
        mk("box", "Fines by violation", "What each ticket costs", 92, "violation", "fine_amount", null),
        mk("bar", "Fines by county", "Total dollars written", 88, "county", "fine_amount", null, "sum"),
        mk("bar", "Issuing agencies", "Who writes the tickets", 82, "issuing_agency", null, null, "count", null, { topN: 10 }),
      ]);
  }

  if (kind === "powerball") {
    return finish("Powerball draws", [
        mk("bar", "Powerball frequency", "How often each red ball came up", 96, "powerball", null, null, "count"),
        mk("histogram", "First white ball", "Lowest number drawn each time", 90, "n1", null, null),
        mk("scatter", "Powerball over time", "Every draw since 2010 (matrix changed in 2015)", 88, "draw_date", "powerball", null),
        mk("bar", "Power Play multipliers", "How often each multiplier hits", 84, "multiplier", null, null, "count"),
        mk("bar", "Draws per year", "Schedule changes show up here", 78, "yr", null, null, "count"),
      ]);
  }

  if (kind === "fed_spending") {
    return finish("Federal agency spending", [
        mk("bar", "Biggest budgets", "Budget authority this fiscal year", 97, "abbreviation", "budget_authority", null, "max", null, { topN: 15 }),
        mk("treemap", "Share of the budget", "Agencies by % of total authority", 94, "agency", "pct_of_total", null, "sum"),
        mk("dumbbell", "Authorized → spent", "Budget authority vs outlays", 92, "abbreviation", "budget_authority", null, "max", "outlays", { topN: 15 }),
        mk("scatter", "Obligated vs outlays", "Committed vs paid", 86, "obligated", "outlays", null),
      ]);
  }

  if (kind === "bikeshare") {
    return finish("Bike share right now", [
        mk("geoPoints", "Docks on the map", "Chicago, DC, and SF — sized by bikes", 97, "longitude", "latitude", "system", null, "bikes_available"),
        mk("box", "How full by city", "% full across each system", 94, "system", "pct_full", null),
        mk("bar", "Bikes vs e-bikes", "Fleet available by system", 90, "system", "bikes_available", null, "sum", null),
        mk("scatter", "Capacity vs bikes", "Big docks running empty or full", 86, "capacity", "bikes_available", "system"),
        mk("histogram", "Dock fullness", "Share of each dock filled", 82, "pct_full", null, null),
      ]);
  }

  if (kind === "bluesky") {
    return finish("Bluesky pulse", [
        mk("bar", "Languages", "Posts by language in recent samples", 96, "key", "posts", "dimension", "sum", null, { topN: 20 }),
        mk("line", "Posts per minute", "Sampled rate by dimension", 92, "ts", "posts_per_min", "dimension", "max"),
        mk("bar", "Top keys", "Biggest languages and hashtags", 88, "key", "posts", null, "sum", null, { topN: 15 }),
      ]);
  }

  if (kind === "bgp") {
    return finish("Internet routing updates", [
        mk("bar", "Busiest origins & lengths", "Prefixes announced in recent samples", 95, "key", "announcements", "dimension", "sum", null, { topN: 20 }),
        mk("line", "Announcements over time", "Per-sample totals", 92, "ts", "announcements", "dimension", "max"),
        mk("scatter", "Announce vs withdraw", "By prefix length", 86, "announcements", "withdrawals", "dimension"),
      ]);
  }

  if (kind === "nobel") {
    return finish("Nobel Prize laureates", [
        mk("bar", "Prizes by category", "How many awards in each field", 96, "category", null, null, "count"),
        mk("line", "Laureates over time", "Awards each year since 1901", 92, "award_year", null, null, "count"),
        mk("bar", "Birth countries", "Where laureates were born", 88, "birth_country", null, null, "count", null, { topN: 15 }),
        mk("bar", "By gender", "Prize shares by gender", 82, "gender", null, null, "count"),
      ]);
  }

  if (kind === "trivia") {
    return finish("Open Trivia questions", [
        mk("bar", "By category", "How many questions in each topic", 96, "category", null, null, "count", null, { topN: 15 }),
        mk("bar", "Difficulty mix", "Easy vs medium vs hard", 92, "difficulty", null, null, "count"),
        mk("bar", "Question types", "True/false vs multiple choice", 88, "question_type", null, null, "count"),
        mk("histogram", "Wrong answers offered", "How many incorrect options each question has", 80, "incorrect_count", null, null),
      ]);
  }

  if (kind === "pokemon") {
    return finish("Pokémon Gen 1", [
        mk("scatter", "Attack vs Defense", "Offensive vs tanky", 96, "attack", "defense", "type1"),
        mk("bar", "Types", "Primary type counts", 94, "type1", null, null, "count"),
        mk("histogram", "Total base stats", "How strong is each Pokémon overall", 90, "total", null, null),
        mk("scatter", "Height vs weight", "Size of the original 151", 84, "height_m", "weight_kg", "type1"),
        mk("bar", "Fastest", "Top Speed stats", 80, "name", "speed", null, "max", null, { topN: 15 }),
      ]);
  }

  if (kind === "met") {
    return finish("Met Museum collection", [
        mk("bar", "By department", "Where highlights live", 96, "department", null, null, "count", null, { topN: 15 }),
        mk("bar", "Public domain share", "Open images vs rights-restricted", 92, "is_public_domain", null, null, "count"),
        mk("bar", "Cultures", "Object cultures in the highlight set", 88, "culture", null, null, "count", null, { topN: 15 }),
        mk("histogram", "Object begin years", "When works were made", 82, "object_begin_year", null, null),
      ]);
  }

  if (kind === "openfood") {
    return finish("Open Food Facts", [
        mk("bar", "Nutri-Score", "How many products at each grade", 96, "nutriscore", null, null, "count"),
        mk("scatter", "Fat vs sugars", "Per 100 g", 92, "fat_100g", "sugars_100g", "nutriscore"),
        mk("bar", "Top brands", "Most common brands in the slice", 88, "brands", null, null, "count", null, { topN: 15 }),
        mk("histogram", "Calories", "Energy per 100 g", 84, "energy_kcal_100g", null, null),
        mk("box", "Protein by Nutri-Score", "Protein grams at each grade", 80, "nutriscore", "proteins_100g", null),
      ]);
  }

  if (kind === "radio") {
    return finish("Radio stations", [
        mk("bar", "By country", "Where top stations broadcast from", 96, "country", null, null, "count", null, { topN: 15 }),
        mk("bar", "Codecs", "Stream formats", 92, "codec", null, null, "count"),
        mk("scatter", "Votes vs clicks", "Popularity signals", 88, "votes", "click_count", "codec"),
        mk("histogram", "Bitrate", "Stream quality in kbps", 84, "bitrate", null, null),
        mk("bar", "Top stations", "Most voted stations", 80, "name", "votes", null, "max", null, { topN: 15 }),
      ]);
  }

  return finish(`${kind} data`, []);
}

// =================================================================
// USAFacts feeds — one curated story per feed, across the chart catalog
// =================================================================
// Panel data (state × year, state × month) gets a "latest period" window for
// maps and rankings, the full span for trends; rates are averaged, never summed;
// mixed-unit pairs are rebased (z-score) so Discover keeps them honest.
// Coverage matrix: docs/USAFACTS.md.

/**
 * Newest value of a column in the sample (years as numbers, months as "YYYY-MM-DD"), only
 * counting rows where `withValue` is filled — a gas-only partial month isn't "the latest month".
 */
function newestCell(data: QueryResult | null, field: string, withValue?: string): string | number | null {
  const i = data?.columns.indexOf(field) ?? -1;
  if (!data || i < 0) return null;
  const w = withValue ? data.columns.indexOf(withValue) : -1;
  let best: string | number | null = null;
  for (const r of data.rows) {
    if (w >= 0 && r[w] == null) continue;
    const v = r[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      if (best == null || (typeof best === "number" && v > best)) best = v;
    } else if (typeof v === "string" && v) {
      if (best == null || String(best) < v) best = v;
    }
  }
  return best;
}

function monthLabel(v: string | number | null): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}/.test(v)) return null;
  return new Date(`${v.slice(0, 7)}-15T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

const USAFACTS_KINDS = ["usafacts_states", "usafacts_nation", "usafacts_state_jobs", "usafacts_budget", "usafacts_budget_lines", "usafacts_household"] as const;
type UsafactsKind = (typeof USAFACTS_KINDS)[number];
const isUsafactsKind = (kind: string): kind is UsafactsKind => (USAFACTS_KINDS as readonly string[]).includes(kind);

/** Forecast band (Loom's own methods) a single-series line opens with. */
/** `months` ahead in calendar time — converted to plotted steps when the chart folds months into years. */
const forecastPreset = (method: "holt" | "line", months: number, anomaly = false): ChartRecommendation["analysisPreset"] => ({
  forecast: { horizon: months, horizonMonths: months, method },
  ...(anomaly ? { anomaly: { window: 12, threshold: 3.5 } } : {}),
});
const anomalyPreset: ChartRecommendation["analysisPreset"] = { anomaly: { window: 12, threshold: 3.5 } };

export function usafactsStory(
  kind: UsafactsKind,
  mk: (
    k: ChartKind, title: string, subtitle: string, score: number,
    xField: string, yField: string | null, colorField: string | null,
    yAgg?: YAggregateOption | null,
    sizeField?: string | null,
    extraEnc?: {
      zField?: string | null;
      timeField?: string | null;
      rowField?: string | null;
      topN?: number | null;
      y2Field?: string | null;
      barStackMode?: "grouped" | "stacked" | "percent" | null;
      rollingWindow?: 7 | 30 | null;
      yScale?: "linear" | "log" | "symlog" | null;
      seriesNormalize?: "index100" | "zscore" | null;
      residualOverlay?: boolean | null;
      anomalyHighlight?: boolean | null;
      bumpMode?: "rank" | "delta" | null;
      pyramidScaleMode?: "auto" | "shared" | "independent" | null;
      deltaDisplay?: "off" | "diff" | "pct" | null;
      timeWindowField?: string | null;
      timeWindow?: ChartTimeRange | null;
      analysisPreset?: ChartRecommendation["analysisPreset"];
    },
  ) => ChartRecommendation,
  data: QueryResult | null,
): [string, ChartRecommendation[]] {
  if (kind === "usafacts_states") {
    const yr = newestCell(data, "yr");
    const when = yr == null ? "latest year" : String(yr);
    const latest = { timeWindowField: "yr", timeWindow: "1y" as const };
    return ["US states, year by year", [
      // Maps + rankings: the newest vintage only.
      mk("choropleth", "Income map", `Median household income by state, ${when}`, 98, "state_abbr", "median_household_income", null, "mean", null, latest),
      mk("choropleth", "Poverty map", `Share of people below the poverty line, ${when}`, 96, "state_abbr", "poverty_rate", null, "mean", null, latest),
      mk("bubble", "Education vs income", `Bachelor's-or-higher share against median income, sized by population, ${when}`, 95, "bachelors_or_higher_pct", "median_household_income", "region", null, "population", latest),
      mk("line", "Real income by region", `Median income in ${when} dollars (CPI-U), average of each region's states`, 94, "yr", "real_median_income", "region", "mean"),
      mk("heatmap", "Poverty, state by year", "Every state's poverty rate, every year since 2012", 93, "yr", "state_abbr", "poverty_rate", "mean"),
      mk("pareto", "Where Americans live", `States ranked by population with the running share, ${when}`, 92, "state_name", "population", null, "sum", null, latest),
      mk("choropleth", "Degrees map", `Adults 25+ with a bachelor's degree or more, ${when}`, 91, "state_abbr", "bachelors_or_higher_pct", null, "mean", null, latest),
      mk("bump", "Income rank over time", "Where the highest-earning states place each year", 90, "yr", "median_household_income", "state_abbr", "mean", null, { bumpMode: "rank", topN: 12 }),
      mk("line", "Income: paycheck vs buying power", `Average state median income, as reported vs in ${when} dollars`, 89, "yr", "median_household_income", null, "mean", null, { y2Field: "real_median_income" }),
      mk("treemap", "Population by region", `Each state's share of the country, grouped by Census region, ${when}`, 88, "state_name", "population", "region", "sum", null, latest),
      mk("scatter", "Income vs poverty · residuals", `States off the income–poverty line, ${when}`, 87, "median_household_income", "poverty_rate", null, null, null, { ...latest, residualOverlay: true }),
      mk("box", "Income spread by region", `How far apart states sit within each region, ${when}`, 86, "region", "median_household_income", null, null, null, latest),
      mk("sparkGrid", "Population, biggest states", "Small multiples since 2012 — who's still growing?", 85, "yr", "population", "state_abbr", "mean", null, { topN: 12 }),
      mk("chernoff", "Region faces", `One face per region: wider = richer, taller = more degrees, eyes farther apart = more poverty, ${when}`, 84, "region", "median_household_income", "poverty_rate", null, "bachelors_or_higher_pct", latest),
      mk("radar", "Region profiles", `Average state in each region across every measure, ${when}`, 83, "poverty_rate", "unemployment_rate", "region", null, null, latest),
      mk("dumbbell", "Poverty vs unemployment", `The gap between the two rates in each state, ${when}`, 82, "state_abbr", "poverty_rate", null, "mean", "unemployment_rate", { ...latest, topN: 20 }),
      mk("pyramid", "Poverty ↔ degrees by region", `Average poverty rate against bachelor's share, ${when}`, 81, "region", "poverty_rate", null, "mean", "bachelors_or_higher_pct", latest),
      mk("stream", "Population by region over time", "How the country's people split across regions since 2012", 80, "yr", "population", "region", "sum"),
      mk("beeswarm", "Every state's degree share", `One dot per state, by region, ${when}`, 79, "region", "bachelors_or_higher_pct", null, null, null, latest),
      mk("ridgeline", "Unemployment spread by year", "How the spread of state unemployment (Census survey) moved", 78, "unemployment_rate", "yr", null),
      mk("parallel", "Every state across the measures", `One line per state, colored by region, ${when}`, 77, "median_household_income", "poverty_rate", "region", null, null, latest),
      mk("waffle", "Americans by region", `Share of the population in each Census region, ${when}`, 76, "region", "population", null, "sum", null, latest),
      mk("violin", "Poverty spread by region", `Distribution of state poverty rates, ${when}`, 75, "region", "poverty_rate", null, null, null, latest),
      mk("errorBars", "Real income by region", `Mean and spread of state median income, ${when}`, 74, "region", "real_median_income", null, "mean", null, latest),
      mk("scatter3d", "Income × poverty × degrees", `Drag to orbit — states by region, ${when}`, 73, "median_household_income", "poverty_rate", "region", null, "population", { ...latest, zField: "bachelors_or_higher_pct" }),
      mk("lollipop", "Most educated states", `Bachelor's-or-higher share, ${when}`, 72, "state_name", "bachelors_or_higher_pct", null, "mean", null, { ...latest, topN: 15 }),
      mk("line", "Median age by year", "The country is getting older — average of states", 71, "yr", "median_age", "region", "mean"),
      mk("corrMatrix", "What moves together", "Income · poverty · education · unemployment · age across every state-year", 70, "median_household_income", "poverty_rate", null),
      mk("forceBubble", "States sized by people", `Bubbles by population, colored by region, ${when}`, 69, "state_abbr", "population", "region", "sum", null, latest),
      mk("histogram", "How state incomes spread", `Median household income across states, ${when}`, 68, "median_household_income", null, null, null, null, latest),
      mk("sunburst", "Regions → states", `Population nested by Census region, ${when}`, 67, "state_name", "population", "region", "sum", null, latest),
      mk("choropleth", "Median age map", `Median age by state, ${when}`, 66, "state_abbr", "median_age", null, "mean", null, latest),
      mk("contour", "Where income and poverty cluster", "Density of every state-year since 2012", 65, "median_household_income", "poverty_rate", null),
      // Cost of living (BEA regional price parities; the newest vintage uses last year's prices).
      mk("choropleth", "What $100 buys", `Price level vs the national average (100) — lower means a dollar goes further, ${when}`, 92.5, "state_abbr", "price_level", null, "mean", null, latest),
      mk("scatter", "Paychecks vs prices", `Median income against the local price level — states above the line out-earn their prices, ${when}`, 91.5, "price_level", "median_household_income", "region", null, null, { ...latest, residualOverlay: true }),
      mk("lollipop", "Income at local prices", `Median household income re-priced to national-average costs, ${when}`, 89.5, "state_name", "income_local_usd", null, "mean", null, { ...latest, topN: 15 }),
      mk("choropleth", "Rent price level", `What rent costs vs the national average (100), ${when}`, 87.5, "state_abbr", "rent_price_level", null, "mean", null, latest),
      mk("dumbbell", "Local prices stretch or shrink income", `Real median income → the same income at local prices, ${when}`, 86.5, "state_abbr", "real_median_income", null, "mean", "income_local_usd", { ...latest, topN: 20 }),
      mk("slope", "Regions after local prices", `Average real median income → at local prices, ${when}`, 85.5, "region", "real_median_income", null, "mean", "income_local_usd", latest),
      mk("heatmap", "Rents, state by year", "Rent price level vs the national average since 2012", 84.5, "yr", "state_abbr", "rent_price_level", "mean"),
      mk("bump", "Real personal income rank", "Per-person income after prices and inflation (BEA), top states each year", 79.5, "yr", "real_personal_income_pc", "state_abbr", "mean", null, { bumpMode: "rank", topN: 12 }),
    ]];
  }

  if (kind === "usafacts_nation") {
    const m = monthLabel(newestCell(data, "month", "jobs_added_k"));
    const lastYear = { timeWindowField: "month", timeWindow: "1y" as const };
    return ["US economy, month by month", [
      mk("line", "Unemployment rate", "Share of the labor force looking for work, since 1990", 98, "month", "unemployment_rate", null, "mean"),
      mk("line", "Inflation", "Consumer prices vs a year earlier (CPI, %)", 97, "month", "inflation_yoy_pct", null, "mean"),
      mk("bar", "Jobs added, last 12 months", `Change in nonfarm payrolls each month${m ? ` through ${m}` : ""} (thousands)`, 96, "month", "jobs_added_k", null, "sum", null, lastYear),
      mk("line", "Rates vs inflation", "Fed funds rate against CPI inflation", 95, "month", "fed_funds_rate", null, "mean", null, { y2Field: "inflation_yoy_pct" }),
      mk("connectedScatter", "Phillips curve, month by month", "Unemployment against inflation, joined in time order — each decade its own color", 94, "unemployment_rate", "inflation_yoy_pct", "decade", null, "month"),
      mk("waterfall", "Jobs added per year", "Each year's net payroll change, building on the last (thousands)", 93, "yr", "jobs_added_k", null, "sum"),
      mk("line", "Unemployment vs inflation", "The two halves of the Fed's job", 92, "month", "unemployment_rate", null, "mean", null, { y2Field: "inflation_yoy_pct" }),
      mk("stripes", "Inflation stripes", "One stripe per month since 1990 — warm when prices ran hot", 91, "month", "inflation_yoy_pct", null),
      mk("connectedScatter", "Beveridge curve", "Unemployment against job openings since 2000 — the labor market's loop", 90, "unemployment_rate", "job_openings_k", "decade", null, "month"),
      mk("line", "Short vs long rates", "Fed funds against the 10-year Treasury — below the dashed line means inverted", 89, "month", "fed_funds_rate", null, "mean", null, { y2Field: "treasury_10y_rate" }),
      mk("line", "The 10-year Treasury rate", "What the government — and every mortgage priced off it — pays to borrow for a decade; recent-trend forecast", 88.5, "month", "treasury_10y_rate", null, "mean", null, { analysisPreset: forecastPreset("holt", 24) }),
      mk("box", "Unemployment in recessions", "Monthly jobless rate in NBER recession months vs expansions", 88, "recession", "unemployment_rate", null, null),
      mk("scatter", "Phillips curve", "One dot per month, colored by recession", 87, "unemployment_rate", "inflation_yoy_pct", "recession"),
      mk("line", "Job openings vs unemployment", "Openings and the jobless rate, rebased to compare their swings", 86, "month", "job_openings_k", null, "mean", null, { y2Field: "unemployment_rate", seriesNormalize: "zscore" }),
      mk("spiral", "Unemployment spiral", "One turn per year since 1990", 85, "month", "unemployment_rate", null),
      mk("box", "Inflation by decade", "Monthly year-over-year CPI, decade by decade", 84, "decade", "inflation_yoy_pct", null),
      mk("line", "Gas prices", "Average regular gasoline, US$ per gallon", 83, "month", "gas_price_usd", null, "mean"),
      mk("slope", "Yield curve by decade", "Average fed funds (start) to 10-year Treasury (end) — a steeper slope pays more to lend long", 82, "decade", "fed_funds_rate", null, "mean", "treasury_10y_rate"),
      mk("line", "Jobs", "Nonfarm payrolls, thousands of jobs", 81, "month", "payrolls_k", null, "mean"),
      mk("horizon", "Inflation horizon", "Bands fold the swings so 36 years fit in one strip", 80, "month", "inflation_yoy_pct", null),
      mk("radar", "How each decade felt", "Average unemployment, inflation, rates, and gas by decade", 79, "unemployment_rate", "inflation_yoy_pct", "decade"),
      mk("violin", "Unemployment by decade", "Distribution of the monthly jobless rate", 78, "decade", "unemployment_rate", null),
      mk("pyramid", "Unemployment ↔ inflation by decade", "Average jobless rate against average inflation", 77, "decade", "unemployment_rate", null, "mean", "inflation_yoy_pct"),
      mk("line", "Housing starts", "New homes started per month (thousands, annualized)", 76, "month", "housing_starts_k", null, "mean", null, { rollingWindow: 7 }),
      mk("bar", "Inflation by year", "Average year-over-year CPI change", 75, "yr", "inflation_yoy_pct", null, "mean"),
      mk("sparkGrid", "Unemployment, decade by decade", "One panel per decade", 74, "month", "unemployment_rate", "decade", "max"),
      mk("ridgeline", "Fed funds by decade", "Where the policy rate sat in each decade", 73, "fed_funds_rate", "decade", null),
      mk("histogram", "How often prices ran hot", "Distribution of monthly CPI inflation since 1990", 72, "inflation_yoy_pct", null, null),
      mk("scatter3d", "Unemployment × inflation × rates", "Drag to orbit — months colored by decade", 71, "unemployment_rate", "inflation_yoy_pct", "decade", null, null, { zField: "fed_funds_rate" }),
      mk("stripes", "Unemployment stripes", "One stripe per month since 1990", 70, "month", "unemployment_rate", null),
      mk("corrMatrix", "What moves together", "Jobs · prices · rates · housing · gas", 69, "unemployment_rate", "inflation_yoy_pct", null),
      mk("dumbbell", "Short vs long rates by decade", "Average fed funds and 10-year Treasury yield", 68, "decade", "fed_funds_rate", null, "mean", "treasury_10y_rate"),
      // Jobs added is ruled by April 2020 (−20.5M) on any linear spread chart, so spreads use rates.
      mk("errorBars", "Fed funds by decade", "Mean and spread of the policy rate", 67, "decade", "fed_funds_rate", null, "mean"),
      mk("density", "Inflation by decade", "Smoothed distribution of monthly CPI inflation", 66, "inflation_yoy_pct", null, "decade"),
      mk("area", "Jobs since 1990", "Nonfarm payrolls, thousands of jobs", 65, "month", "payrolls_k", null, "mean"),
    ]];
  }

  if (kind === "usafacts_budget") {
    const m = monthLabel(newestCell(data, "month", "receipts_b"));
    const lastYear = { timeWindowField: "month", timeWindow: "1y" as const };
    return ["Federal budget, month by month", [
      mk("line", "Interest's bite out of every tax dollar", "Net interest as a share of federal revenue, 12-month totals — with Loom's recent-trend forecast", 98, "month", "interest_share_pct", null, "mean", null, { analysisPreset: forecastPreset("holt", 24) }),
      mk("line", "Interest vs defense", "12-month net interest against 12-month national defense spending", 97, "month", "net_interest_ttm_b", null, "mean", null, { y2Field: "defense_ttm_b" }),
      mk("line", "The deficit, 12 months at a time", "Outlays minus receipts over each trailing year — straight-line forecast", 96, "month", "deficit_ttm_b", null, "mean", null, { analysisPreset: forecastPreset("line", 24) }),
      mk("line", "Tariff money in — and back out", "Customs duties each month; rings mark months far from their trailing pattern", 95, "month", "customs_duties_b", null, "mean", null, { analysisPreset: anomalyPreset }),
      mk("bar", "Tariffs, the last 12 months", `Customs duties each month${m ? ` through ${m}` : ""} ($ billions; below zero = refunds)`, 94, "month", "customs_duties_b", null, "sum", null, lastYear),
      mk("line", "Money in vs money out", "12-month receipts against 12-month outlays — the gap is the deficit", 93, "month", "receipts_ttm_b", null, "mean", null, { y2Field: "outlays_ttm_b" }),
      mk("line", "What the Treasury pays to borrow", "Average interest rate on marketable debt — recent-trend forecast", 92, "month", "avg_interest_rate_pct", null, "mean", null, { analysisPreset: forecastPreset("holt", 24) }),
      mk("connectedScatter", "The rate drives the bill", "Average rate on the debt against 12-month net interest, joined month by month", 91, "avg_interest_rate_pct", "net_interest_ttm_b", null, null, "month"),
      mk("waterfall", "Deficits pile up", "Each fiscal year's deficit stacked on the last ($ billions; FY2015 starts in March, the newest year is partial)", 90, "fy", "deficit_b", null, "sum"),
      mk("dumbbell", "An average month, in vs out", "Mean monthly receipts → mean monthly outlays, each fiscal year", 89, "fy", "receipts_b", null, "mean", "outlays_b"),
      mk("scatter", "Higher rates, bigger bite", "Average rate on the debt against interest's share of revenue", 88, "avg_interest_rate_pct", "interest_share_pct", null),
      mk("stripes", "Deficit stripes", "One stripe per month since 2015 — warm months borrowed the most", 87, "month", "deficit_b", null),
      mk("spiral", "The tax calendar", "Monthly deficits, one turn per year — April's tax surplus shows every lap", 86, "month", "deficit_b", null),
      mk("box", "Monthly deficits by fiscal year", "Spread of each year's months", 85, "fy", "deficit_b", null),
      mk("line", "Tariffs, 12-month total", "Customs duties over each trailing year", 84, "month", "customs_ttm_b", null, "mean"),
      mk("horizon", "Spending, folded", "Monthly outlays in bands", 83, "month", "outlays_b", null),
      mk("corrMatrix", "What moves together", "Receipts · outlays · interest · rates · tariffs", 82, "net_interest_b", "avg_interest_rate_pct", null),
      mk("histogram", "A typical month's deficit", "Distribution of monthly deficits since 2015 ($ billions)", 81, "deficit_b", null, null),
      mk("scatter3d", "Rate × interest × deficit", "Drag to orbit — every month since 2016", 80, "avg_interest_rate_pct", "net_interest_ttm_b", null, null, null, { zField: "deficit_ttm_b" }),
      mk("bar", "Net interest by fiscal year", "Interest paid each fiscal year ($ billions; partial years at the ends)", 79, "fy", "net_interest_b", null, "sum"),
      mk("pyramid", "Interest ↔ defense, each fiscal year", "Mean monthly net interest against mean monthly defense", 78, "fy", "net_interest_b", null, "mean", "defense_b"),
      mk("errorBars", "Interest per month, by fiscal year", "Mean and spread of monthly net interest", 77, "fy", "net_interest_b", null, "mean"),
      mk("ridgeline", "Monthly deficits, year by year", "How each fiscal year's months spread", 76, "deficit_b", "fy", null),
      mk("area", "Spending, 12 months at a time", "Total outlays over each trailing year ($ billions)", 75, "month", "outlays_ttm_b", null, "mean"),
      mk("violin", "Deficit months by fiscal year", "Shape of each year's monthly deficits", 74, "fy", "deficit_b", null),
      mk("beeswarm", "Every month's interest bill", "One dot per month, by fiscal year", 73, "fy", "net_interest_b", null),
      mk("slope", "Receipts → outlays, each fiscal year", "Mean monthly money in → money out", 72, "fy", "receipts_b", null, "mean", "outlays_b"),
      mk("sparkGrid", "Deficits, year by year", "One small panel per fiscal year", 71, "month", "deficit_b", "fy", "sum", null, { topN: 14 }),
    ]];
  }

  if (kind === "usafacts_budget_lines") {
    const lastYear = { timeWindowField: "month", timeWindow: "1y" as const };
    const latest = { timeWindowField: "month", timeWindow: "30d" as const };
    return ["Where federal money comes from and goes", [
      mk("bump", "Net interest climbs the ranks", "Rank of every receipt and spending line by its 12-month total, each fiscal year", 98, "fy", "amount_ttm_b", "line", "mean", null, { bumpMode: "rank", topN: 14 }),
      mk("line", "Every line, 12-month totals", "Receipt sources and spending functions, one panel each", 97, "month", "amount_ttm_b", "line", "max", null, { rowField: "flow", topN: 14 }),
      mk("heatmap", "Each line's share, year by year", "Share of its flow's 12-month total, by fiscal year", 96, "fy", "line", "share_ttm_pct", "mean"),
      mk("treemap", "The last 12 months: in vs out", "Every receipt source and spending function — the outlays block is bigger by the deficit", 95, "line", "amount_ttm_b", "flow", "sum", null, latest),
      mk("sparkGrid", "Line by line", "12-month totals since 2016, one small multiple per line", 93, "month", "amount_ttm_b", "line", "max", null, { topN: 14 }),
      mk("bar", "Every line, the last 12 months", "Receipts and spending side by side ($ billions)", 92, "line", "amount_ttm_b", "flow", "sum", null, { ...latest, topN: 14 }),
      mk("sunburst", "Flows → lines", "The last 12 months nested by receipts and outlays", 90, "line", "amount_ttm_b", "flow", "sum", null, latest),
      mk("lollipop", "Shares right now", "Each line's share of its flow, newest 12 months", 89, "line", "share_ttm_pct", null, "mean", null, latest),
      mk("box", "How lumpy is each line?", "Spread of monthly amounts — tax months and interest dates stand out", 85, "line", "amount_b", null),
      mk("radialBar", "The last 12 months, around the dial", "Every line's 12-month amount", 84, "line", "amount_ttm_b", null, "sum", null, latest),
      mk("line", "Tariffs vs net interest, monthly", "Two lines from opposite sides of the ledger — monthly amounts, last 12 months", 83, "month", "amount_b", "line", "sum", null, { ...lastYear, topN: 14 }),
      mk("ridgeline", "Shares over time", "Distribution of each line's share since 2016", 82, "share_ttm_pct", "line", null),
    ]];
  }

  if (kind === "usafacts_household") {
    return ["Household finances, quarter by quarter", [
      mk("line", "Credit card delinquency", "Share of card balances 30+ days past due — recent-trend forecast and anomaly rings", 98, "quarter", "card_delinquency_pct", null, "mean", null, { analysisPreset: forecastPreset("holt", 24, true) }),
      mk("line", "A home costs this many years of pay", "Median new-home price ÷ a year of median full-time pay — recent-trend forecast", 97, "quarter", "home_price_years_of_pay", null, "mean", null, { analysisPreset: forecastPreset("holt", 24) }),
      mk("line", "The saving rate", "Share of disposable income households save — rings mark breaks from pattern", 96, "quarter", "saving_rate_pct", null, "mean", null, { analysisPreset: anomalyPreset }),
      mk("line", "Home prices vs paychecks", "Median new-home price and median weekly pay, both rebased to 1990 = 100", 95.5, "quarter", "median_home_price_usd", null, "mean", null, { y2Field: "median_weekly_earnings_usd", seriesNormalize: "index100" }),
      mk("line", "Card vs mortgage delinquency", "Two kinds of falling behind", 95, "quarter", "card_delinquency_pct", null, "mean", null, { y2Field: "mortgage_delinquency_pct" }),
      mk("line", "Renting vs owning", "Rental vacancy and homeownership, rebased to compare their swings", 94, "quarter", "rental_vacancy_pct", null, "mean", null, { y2Field: "homeownership_pct", seriesNormalize: "zscore" }),
      mk("line", "Empty rentals", "Share of rental homes sitting vacant — recent-trend forecast", 93.8, "quarter", "rental_vacancy_pct", null, "mean", null, { analysisPreset: forecastPreset("holt", 24) }),
      mk("line", "Debt payments' share of income", "Required household debt payments ÷ disposable income — recent-trend forecast", 93.6, "quarter", "debt_service_pct", null, "mean", null, { analysisPreset: forecastPreset("holt", 24) }),
      mk("line", "Revolving credit", "Credit card and other revolving balances ($ billions) — straight-line forecast", 93, "quarter", "revolving_credit_b", null, "mean", null, { analysisPreset: forecastPreset("line", 24) }),
      mk("connectedScatter", "Debt payments vs delinquency", "Debt service share of income against card delinquency, joined quarter by quarter", 92, "debt_service_pct", "card_delinquency_pct", null, null, "quarter"),
      mk("box", "Delinquency in recessions", "Card delinquency in NBER recession quarters vs expansions", 91, "recession", "card_delinquency_pct", null),
      mk("scatter", "Saving vs falling behind", "Saving rate against card delinquency, colored by recession", 90, "saving_rate_pct", "card_delinquency_pct", "recession"),
      mk("stripes", "Mortgage delinquency stripes", "One stripe per quarter since 1991 — the housing bust burns hot", 89, "quarter", "mortgage_delinquency_pct", null),
      mk("line", "Working-age jobs vs participation", "Prime-age employment rate against labor-force participation", 88, "quarter", "prime_age_employment_pct", null, "mean", null, { y2Field: "labor_force_participation_pct" }),
      mk("area", "Real income per person", "Disposable income per person after inflation (2017 dollars)", 87, "quarter", "real_disposable_income_pc", null, "mean"),
      mk("violin", "Card delinquency by decade", "Distribution of quarterly delinquency rates", 86, "decade", "card_delinquency_pct", null),
      mk("ridgeline", "Saving rate by decade", "How much households kept, decade by decade", 85, "saving_rate_pct", "decade", null),
      mk("scatter3d", "Delinquency × debt service × saving", "Drag to orbit — quarters colored by recession", 84, "debt_service_pct", "card_delinquency_pct", "recession", null, null, { zField: "saving_rate_pct" }),
      mk("corrMatrix", "What moves together", "Saving · delinquency · debt · housing · jobs", 83, "saving_rate_pct", "card_delinquency_pct", null),
      mk("horizon", "Years of pay, folded", "The affordability path in bands", 82, "quarter", "home_price_years_of_pay", null),
      mk("bar", "Jobless claims by year", "Average weekly initial claims (thousands)", 81, "yr", "initial_claims_k", null, "mean"),
      mk("dumbbell", "Card vs mortgage, by decade", "Average card delinquency → mortgage delinquency", 80, "decade", "card_delinquency_pct", null, "mean", "mortgage_delinquency_pct"),
      mk("errorBars", "Saving by decade", "Mean and spread of the saving rate", 79, "decade", "saving_rate_pct", null, "mean"),
      mk("pyramid", "Card ↔ mortgage delinquency by decade", "Average rates side by side", 78, "decade", "card_delinquency_pct", null, "mean", "mortgage_delinquency_pct"),
      mk("beeswarm", "Saving in recessions vs expansions", "One dot per quarter", 77, "recession", "saving_rate_pct", null),
      mk("histogram", "How often homes cost this much", "Distribution of a home's price in years of pay since 1990", 76, "home_price_years_of_pay", null, null),
      mk("sparkGrid", "Card delinquency, decade by decade", "One panel per decade", 75, "quarter", "card_delinquency_pct", "decade", "max"),
      mk("density", "Delinquency in good times and bad", "Smoothed distribution, recessions vs expansions", 74, "card_delinquency_pct", null, "recession"),
      mk("ecdf", "The saving rate's track record", "Share of quarters at or below each saving rate, recessions vs expansions", 73, "saving_rate_pct", null, "recession"),
    ]];
  }

  // usafacts_state_jobs — one row per state-month (BLS LAUS)
  const m = monthLabel(newestCell(data, "month", "unemployment_rate"));
  const when = m ?? "latest month";
  const latest = { timeWindowField: "month", timeWindow: "30d" as const };
  const lastYear = { timeWindowField: "month", timeWindow: "1y" as const };
  return ["State unemployment, month by month", [
    mk("choropleth", "Unemployment map", `Official jobless rate by state, ${when}`, 98, "state_abbr", "unemployment_rate", null, "mean", null, latest),
    mk("heatmap", "Every state, year by year", "Average jobless rate since 2008 — the 2009–10 and 2020 walls stand out", 97, "yr", "state_abbr", "unemployment_rate", "mean"),
    mk("choropleth", "Change vs a year ago", `Percentage points up or down from 12 months earlier, ${when}`, 96, "state_abbr", "unemployment_change_yoy", null, "mean", null, latest),
    mk("line", "Regions since 2008", "Average state jobless rate in each Census region", 95, "month", "unemployment_rate", "region", "mean"),
    mk("bar", "Biggest rises vs a year ago", `States where unemployment climbed most, ${when}`, 94, "state_name", "unemployment_change_yoy", null, "mean", null, { ...latest, topN: 15 }),
    mk("sparkGrid", "State by state", "Small multiples since 2008 for the states running highest", 93, "month", "unemployment_rate", "state_abbr", "mean", null, { topN: 12 }),
    mk("lollipop", "Highest unemployment now", `Jobless rate, ${when}`, 92, "state_name", "unemployment_rate", null, "mean", null, { ...latest, topN: 15 }),
    mk("bump", "Who runs highest, year by year", "Rank of each state's average jobless rate", 91, "yr", "unemployment_rate", "state_abbr", "mean", null, { bumpMode: "rank", topN: 12 }),
    mk("box", "Spread across states each year", "How far apart the states sit, 2008 to now", 90, "yr", "unemployment_rate", null),
    mk("beeswarm", "Every state, by region", `One dot per state, ${when}`, 89, "region", "unemployment_rate", null, null, null, latest),
    mk("line", "Average state, last 12 months", "Mean of state rates by month", 88, "month", "unemployment_rate", null, "mean", null, lastYear),
    mk("ridgeline", "Regions over the last year", "Distribution of state-months by region", 87, "unemployment_rate", "region", null, null, null, lastYear),
    mk("violin", "Spread by region", "State jobless rates within each region over the last 12 months", 86, "region", "unemployment_rate", null, null, null, lastYear),
    mk("errorBars", "Regions: mean and spread", "Last 12 months of state rates", 85, "region", "unemployment_rate", null, "mean", null, lastYear),
    mk("horizon", "Unemployment horizon", "Average state rate since 2008, folded into bands", 84, "month", "unemployment_rate", null, "mean"),
    mk("histogram", "How rates spread now", `Jobless rate across states, ${when}`, 83, "unemployment_rate", null, null, null, null, latest),
    mk("stripes", "Unemployment stripes", "Average state rate, one stripe per month", 82, "month", "unemployment_rate", null),
    mk("spiral", "Unemployment spiral", "Average state rate, one turn per year", 81, "month", "unemployment_rate", null),
    mk("scatter", "Level vs change", `Jobless rate against its change from a year earlier, ${when}`, 80, "unemployment_rate", "unemployment_change_yoy", "region", null, null, latest),
    mk("density", "Regions compared", `Smoothed distribution of state rates, last 12 months`, 79, "unemployment_rate", null, "region", null, null, lastYear),
  ]];
}
