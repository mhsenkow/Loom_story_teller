// =================================================================
// socialKey — which chart a vote or comment belongs to
// =================================================================
// Community items are chart *recipes* on public live feeds: the source
// plus the encodings that change what the chart says (not its title,
// colors or tooltip). A discover story and the chart it opens share one
// key; an edited chart becomes its own item. Private files never get a
// key, so nothing about people's own data reaches the community.
// =================================================================

import type { ChartRecommendation } from "./recs/types";
import { chartLinkFromState, decodeChartLink, encodeChartLink } from "./chartLink";
import { discoverFieldLabel } from "./discoverEditorial";
import type { LoomState } from "./store/types";
import { recipeKeyFromChart } from "./socialRecipe";

/** Fields that make a recipe (the normalization lives in socialRecipe). */
type RecipeField =
  | "kind"
  | "xField"
  | "yField"
  | "colorField"
  | "sizeField"
  | "zField"
  | "rowField"
  | "y2Field"
  | "yAggregate"
  | "timeWindow"
  | "topN"
  | "barStackMode"
  | "seriesNormalize"
  | "rollingWindow"
  | "wordCloudMode"
  | "anomalyHighlight"
  | "bumpMode";

/** Source kind for a public live feed path (`stream://usgs` → `usgs`), else null. */
export function socialKindFromPath(path: string | null | undefined): string | null {
  const m = path?.match(/^stream:\/\/([a-z0-9_]{1,40})$/);
  return m ? m[1]! : null;
}

/** `usgs:k3j9x0` — stable across devices for the same feed + recipe (see socialRecipe). */
export function socialKey(kind: string, chart: Partial<Pick<ChartRecommendation, RecipeField>>): string {
  return recipeKeyFromChart(kind, chart as Record<string, unknown>);
}

/**
 * `chart=…` that rebuilds this recipe from its public feed. The server keeps only
 * the recipe (feed, chart type, column names, a few settings) — never titles or notes.
 */
export function socialLinkFor(path: string, name: string, chart: ChartRecommendation): string | undefined {
  if (!socialKindFromPath(path)) return undefined;
  const link = chartLinkFromState({
    activeChart: { ...chart, title: "", subtitle: "", tooltipFields: undefined },
    selectedFile: { path, name },
    chartTitleOverrides: {},
    // Stacking is part of the recipe; carry it so the chart reopens the same way.
    barStackMode: chart.barStackMode ?? undefined,
  } as unknown as Parameters<typeof chartLinkFromState>[0]);
  return link ? encodeChartLink(link) : undefined;
}

export interface SocialTarget {
  key: string;
  title: string;
  link?: string;
}

/** The community item for whatever chart is open, or null for private data / no chart. */
export function socialTargetFromState(
  s: Pick<LoomState, "activeChart" | "selectedFile" | "chartTitleOverrides">,
): SocialTarget | null {
  const chart = s.activeChart;
  const file = s.selectedFile;
  const kind = socialKindFromPath(file?.path);
  if (!chart || !file || !kind || !chart.xField) return null;
  const title = s.chartTitleOverrides?.[chart.id] || chart.title || file.name;
  return {
    // Always the recipe on screen, so the key and the link sent with it agree.
    key: socialKey(kind, chart),
    title,
    link: socialLinkFor(file.path, file.name, chart),
  };
}

/**
 * A plain description of a community chart from its recipe link — used when no
 * local story names it. Built from column names only: "Magnitude by place".
 */
export function socialTitleFromLink(link: string | null | undefined): string | null {
  const decoded = link ? decodeChartLink(link) : null;
  if (!decoded) return null;
  const c = decoded.chart;
  const cap = (t: string) => t.replace(/^\p{Ll}/u, (ch) => ch.toUpperCase());
  const x = discoverFieldLabel(c.xField);
  if (c.yField && c.yField !== c.xField) return `${cap(discoverFieldLabel(c.yField))} by ${x}`;
  if (c.colorField && c.colorField !== c.xField) return `Count by ${x} and ${discoverFieldLabel(c.colorField)}`;
  return `Count by ${x}`;
}
