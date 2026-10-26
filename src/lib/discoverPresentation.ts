// =================================================================
// Discover presentation — settings, search and a varied opening page.
// Shared by the landing cards and filters; recommendations remain the
// source of truth for every setting applied when a story opens.
// =================================================================

import type { DiscoverStory } from "./discoverStories";
import {
  CHART_KIND_OPTIONS,
  type ChartRecommendation,
} from "./recommendations";
import {
  applyChartTimeWindow,
  chartDataTimeSpan,
  chartTimeWindowLabel,
  formatChartTimeSpanRange,
  pickDefaultTimeField,
} from "./chartTime";
import { discoverFamily, DISCOVER_FAMILIES, discoverQuestionKey } from "./discoverChartCatalog";
import { orderDiscoverStories } from "./discoverRanking";

export const DISCOVER_PAGE_SIZE = 24;
export interface DiscoverStoryGroup {
  id: string;
  stories: DiscoverStory[];
}

/** Group the same question across chart kinds and presentation settings. */
export function groupDiscoverStories(
  stories: DiscoverStory[],
): DiscoverStoryGroup[] {
  const groups = new Map<string, DiscoverStoryGroup>();
  for (const story of stories) {
    const chart = story.chart;
    const id = discoverQuestionKey(story.kind, chart);
    const group = groups.get(id);
    if (group) group.stories.push(story);
    else groups.set(id, { id, stories: [story] });
  }
  // The feed's headline is the card for its question, even when a sibling scored higher.
  for (const g of groups.values()) {
    const i = g.stories.findIndex((s) => s.headline);
    if (i > 0) g.stories.unshift(...g.stories.splice(i, 1));
  }
  return [...groups.values()];
}
export const DISCOVER_SETTING_FILTERS = [
  { value: "all", label: "Any settings" },
  { value: "compare", label: "Comparisons & Δ" },
  { value: "facet", label: "Small multiples" },
  { value: "window", label: "Time windows" },
  { value: "stack", label: "Stacked & grouped" },
  { value: "transform", label: "Trends & transforms" },
  { value: "symbols", label: "Emoji & shapes" },
] as const;
export type DiscoverSettingFilter =
  (typeof DISCOVER_SETTING_FILTERS)[number]["value"];

export function matchesDiscoverSetting(
  chart: ChartRecommendation,
  setting: DiscoverSettingFilter,
): boolean {
  switch (setting) {
    case "symbols":
      return !!(chart.emojiField || chart.shapeField);
    case "compare":
      return !!(
        chart.y2Field ||
        chart.comparePrevious ||
        (chart.sizeField &&
          ["pyramid", "slope", "dumbbell"].includes(chart.kind)) ||
        chart.bumpMode === "delta" ||
        chart.wordCloudMode === "compare" ||
        chart.wordCloudMode === "grid"
      );
    case "facet":
      return !!chart.rowField;
    case "window":
      return !!chart.timeWindow && chart.timeWindow !== "all";
    case "stack":
      return !!chart.barStackMode;
    case "transform":
      return !!(
        chart.rollingWindow ||
        chart.seriesNormalize ||
        chart.residualOverlay ||
        chart.anomalyHighlight ||
        (chart.yScale && chart.yScale !== "linear")
      );
    default:
      return true;
  }
}

export function discoverChartLabel(kind: string): string {
  if (kind === "maps") return "Maps";
  if (kind.startsWith("family:")) return DISCOVER_FAMILIES[kind.slice(7) as keyof typeof DISCOVER_FAMILIES]?.label ?? kind;
  return (
    CHART_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind
  );
}

/** Human-readable settings, including the variants that share one chart kind. */
export function discoverChartSettings(chart: ChartRecommendation): string[] {
  const settings: string[] = [];
  if (chart.timeWindow && chart.timeWindow !== "all")
    settings.push(`Window · ${chart.timeWindow}`);
  if (chart.rowField) settings.push(`Facet · ${chart.rowField}`);
  if (chart.shapeField) settings.push(`Shapes · ${chart.shapeField}`);
  if (chart.emojiField) settings.push(`Emoji · ${chart.emojiField}`);
  if (chart.zField) settings.push(`Depth · ${chart.zField}`);
  if (chart.timeField) settings.push(`Time · ${chart.timeField}`);
  if (chart.trailId) settings.push(`Trails · ${chart.trailId}`);
  if (chart.layoutDirection && chart.layoutDirection !== "auto") settings.push(`Direction · ${chart.layoutDirection}`);
  if (chart.channelInvert && Object.values(chart.channelInvert).some(Boolean)) settings.push("Inverted channels");
  if (chart.topN != null) settings.push(`Top ${chart.topN}`);
  if (chart.barStackMode === "stacked") settings.push("Stacked");
  if (chart.barStackMode === "percent") settings.push("100% stacked");
  if (chart.barStackMode === "grouped") settings.push("Grouped");
  if (chart.yAggregate)
    settings.push(chart.yAggregate === "mean" ? "Average" : chart.yAggregate);
  if (chart.y2Field) settings.push(`Compare · ${chart.y2Field}`);
  if (chart.comparePrevious) settings.push("Earlier-half comparison");
  if (chart.deltaDisplay === "diff") settings.push("Δ difference");
  if (chart.deltaDisplay === "pct") settings.push("% difference");
  if (chart.pyramidScaleMode)
    settings.push(
      chart.pyramidScaleMode === "shared"
        ? "Same scale"
        : chart.pyramidScaleMode === "independent"
          ? "Separate scales"
          : "Auto scales",
    );
  if (chart.rollingWindow)
    settings.push(`Rolling average · ${chart.rollingWindow}`);
  if (chart.yScale && chart.yScale !== "linear")
    settings.push(`${chart.yScale} scale`);
  if (chart.seriesNormalize === "index100") settings.push("Indexed to 100");
  if (chart.seriesNormalize === "zscore") settings.push("Z-score");
  if (chart.residualOverlay) settings.push("Residuals");
  if (chart.anomalyHighlight) settings.push("Anomalies");
  if (chart.bumpMode === "delta") settings.push("Δ rank");
  if (chart.wordCloudMode === "compare") settings.push("Word comparison");
  if (chart.wordCloudMode === "grid") settings.push("Word cloud grid");
  return settings;
}

export function matchesDiscoverSearch(
  story: DiscoverStory,
  query: string,
): boolean {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = [
    story.hook,
    story.blurb,
    story.category,
    story.fileName,
    story.insight?.label,
    story.insight?.detail,
    DISCOVER_FAMILIES[discoverFamily(story.chartKind)].label,
    DISCOVER_FAMILIES[discoverFamily(story.chartKind)].prompt,
    discoverChartLabel(story.chartKind),
    story.chart.xField,
    story.chart.yField,
    story.chart.sizeField,
    story.chart.colorField,
    story.chart.y2Field,
    story.chart.zField,
    story.chart.rowField,
    ...discoverChartSettings(story.chart),
  ]
    .join(" ")
    .toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * Interleave sources and chart kinds even when the entire pool fits the cap.
 * `scoreOf` lets display add per-source affinity without touching `story.score`
 * (the cached daily scan stays preference-free).
 */
export function rankDiscoverStories(
  stories: DiscoverStory[],
  scoreOf: (story: DiscoverStory) => number = (story) => story.score,
): DiscoverStory[] {
  return orderDiscoverStories(stories, scoreOf);
}

export function discoverEvidence(story: DiscoverStory): {
  coverage: string;
  shortCoverage: string;
  period: string | null;
  cached: boolean;
} {
  const timed = applyChartTimeWindow(
    story.sample.rows,
    story.sample.columns,
    story.chart,
  );
  const count = timed.rows.length;
  const total = story.sample.total_rows;
  const coverage = timed.filtered
    ? `${count.toLocaleString()} rows in window`
    : total > count
      ? `${count.toLocaleString()} of ${total.toLocaleString()} rows`
      : `${count.toLocaleString()} rows`;
  const shortCoverage = timed.filtered
    ? `${count.toLocaleString()} in window`
    : total > count
      ? `${count.toLocaleString()}/${total.toLocaleString()} rows`
      : `${count.toLocaleString()} rows`;
  const field =
    story.chart.timeWindowField ??
    pickDefaultTimeField(story.stats, story.chart);
  const span = chartDataTimeSpan(timed.rows, story.sample.columns, field);
  const window = chartTimeWindowLabel(
    story.chart.timeWindow,
    timed.mode ?? undefined,
  );
  return {
    coverage,
    shortCoverage,
    period: span ? formatChartTimeSpanRange(span.minMs, span.maxMs) : window,
    cached: story.snapshotCached === true,
  };
}
