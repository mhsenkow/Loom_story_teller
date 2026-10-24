// =================================================================
// analysisVernacular — DS + layman + LLM-style talk → Loom intents
// =================================================================
// How people actually ask for charts: “distribution”, “over time”,
// “what’s correlated”, “share of total”, “map it”, “log scale”, etc.
// Used by chartKindSearch synonyms and the command palette.
// =================================================================

import type { ChartKind } from "./recommendations";
import type { VisualPresetId } from "./lookSystem";

/** Extra search words per chart kind (merged into chartKindSearch). */
export const CHART_KIND_VERNACULAR: Partial<Record<string, string>> = {
  scatter:
    "dot point xy correlation relationship bivariate associated associated with vs versus against scatterplot scatter plot pairwise covary",
  bubble: "sized bubbles third dimension magnitude weighted points",
  hexbin: "density aggregate crowded scatter binned hex honeycomb overplotting",
  line: "trend time series temporal over time trajectory trajectory growth decline timeseries line chart",
  bar: "column compare categories categorical ranking ranking bars grouped bar chart",
  lollipop: "dot plot stem ranking sparse categories",
  dumbbell: "before after gap pair compare two points range",
  pyramid: "mirror tornado population pyramid opposing bars same scale separate scales age sex cases deaths",
  area: "filled trend cumulative volume stacked area stream",
  pie: "donut share part whole composition percentage breakdown pie chart",
  funnel: "conversion stages dropoff pipeline drop-off",
  histogram: "distribution bins frequency density hist spread shape skew unimodal",
  density: "density kde kernel smooth distribution curve bell shape spread",
  qq: "qq quantile quantile normality normal probability plot skew tails",
  connectedScatter: "connected scatter path trajectory over time loop journey",
  stripes: "warming stripes climate hawkins barcode bands trend anomaly",
  wordCloud: "word cloud tag cloud text frequency words",
  errorBars: "error bars confidence interval mean ci uncertainty dot plot",
  ecdf: "cumulative distribution cdf percentile quantile median tail share below",
  calendar: "calendar heatmap github contributions daily activity weekday streak days",
  rose: "nightingale rose coxcomb polar area wedge petal",
  sparkGrid: "sparklines small multiples trellis facet trends mini lines grid",
  waterfall: "bridge running total contribution incremental delta breakdown p&l",
  strip: "jitter one dimensional distribution strip plot",
  violin: "distribution density shape multimodal kde violin plot",
  ridgeline: "joyplot joy plot distributions by group overlapping density ridges",
  box: "boxplot quartile iqr outliers five number summary box and whisker",
  radar: "spider web multivariate profile polar radar chart",
  parallel: "multivariate axes parallel coordinates brushing high dimensional",
  heatmap: "matrix grid density intensity correlation heat map",
  treemap: "nested hierarchy part whole rectangular mosaic treemap",
  sunburst: "radial hierarchy rings multilevel sunburst",
  forceBubble: "packed bubbles force layout collision",
  sankey: "flow alluvial migration transfer from to paths sankey",
  network: "graph force directed links nodes edges relationships network",
  arcDiagram: "arc links linear network sequence arcs",
  pareto: "80 20 cumulative ranked abc analysis vital few pareto",
  corrMatrix: "correlation pearson heatmap matrix r pairwise associations corr",
  choropleth: "map region country state geographic geo spatial choropleth shaded map",
  scatter3d: "3d orbit point cloud xyz three dimensional",
  dataCube: "3d cube voxel olap pivot rows columns depth multidimensional",
  firefly: "particles glow animated swarm",
  quakeTerrain: "3d heightfield surface terrain elevation",
  trailRibbon: "path trajectory tracks motion trails",
  loomWeave: "textile threads weave fabric",
};

export type VernacularChartExtras = {
  yScale?: "log" | "symlog" | null;
  barStackMode?: "grouped" | "stacked" | "percent" | null;
  anomalyHighlight?: boolean | null;
  yAggregate?: "sum" | "mean" | "count" | "min" | "max" | null;
  topN?: number | null;
  rollingWindow?: 7 | 30 | null;
  residualOverlay?: boolean | null;
  seriesNormalize?: "index100" | "zscore" | null;
};

export type VernacularHit = {
  /** Apply this chart kind (opens Chart). */
  kind?: ChartKind;
  /** Apply a look preset. */
  look?: VisualPresetId;
  /** Side actions. */
  action?:
    | "panel:chart"
    | "panel:stats"
    | "panel:export"
    | "clear-filters"
    | "encoding"
    | "deep-scan"
    | "explain-column"
    | "lock-color"
    | "reset-view";
  label: string;
  hint: string;
  score: number;
  extras?: VernacularChartExtras;
  /** Column names mentioned in the query (best-effort). */
  fields?: string[];
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip politeness / bot wrappers so intents still fire. */
export function stripTalkFiller(raw: string): string {
  return raw
    .replace(/^(please|pls|hey|ok|sure|can you|could you|would you|i want to|i'd like to|id like to|let's|lets|just)\s+/i, "")
    .replace(/^(show me|show|plot|draw|visualize|visualise|make|create|build|give me|i need|i want)\s+(a|an|the|me|us)?\s*/i, "")
    .replace(/\b(please|thanks|thank you)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type IntentRule = {
  /** Test against normalized stripped query. */
  test: (q: string) => boolean;
  hit: Omit<VernacularHit, "fields">;
};

const INTENT_RULES: IntentRule[] = [
  // Distributions
  {
    test: (q) =>
      /\b(distribution|distrib|histogram|hist|bins?|frequency|how (is|are) .+ distributed|spread of|shape of)\b/.test(q) ||
      /\b(kde|density plot)\b/.test(q),
    hit: {
      kind: "histogram",
      label: "Chart as Histogram",
      hint: "Distribution · bins · frequency",
      score: 48,
    },
  },
  {
    test: (q) => /\b(violin|kde by group|density by)\b/.test(q),
    hit: { kind: "violin", label: "Chart as Violin", hint: "Distribution shape by group", score: 46 },
  },
  {
    test: (q) => /\b(box ?plot|boxplot|quartiles?|iqr|five number)\b/.test(q),
    hit: { kind: "box", label: "Chart as Box", hint: "Quartiles · outliers", score: 46 },
  },
  {
    test: (q) => /\b(ridgeline|joy ?plot)\b/.test(q),
    hit: { kind: "ridgeline", label: "Chart as Ridgeline", hint: "Stacked densities", score: 45 },
  },

  // Relationships
  {
    test: (q) =>
      /\b(scatter|correlation between|correlated|relationship between|vs\.?|versus|against each other|bivariate|associa)\b/.test(q) ||
      /\b(x vs y|plot .+ vs )\b/.test(q),
    hit: {
      kind: "scatter",
      label: "Chart as Scatter",
      hint: "Relationship · X vs Y",
      score: 47,
    },
  },
  {
    test: (q) => /\b(corr(elation)? matrix|pairwise corr|correlation heatmap|pearson)\b/.test(q),
    hit: {
      kind: "corrMatrix",
      label: "Chart as Correlation matrix",
      hint: "Pairwise associations",
      score: 49,
    },
  },
  {
    test: (q) => /\b(residual|fit line|regression residual)\b/.test(q),
    hit: {
      kind: "scatter",
      label: "Scatter with residuals",
      hint: "Relationship + residual stems",
      score: 44,
      extras: { residualOverlay: true },
    },
  },

  // Time
  {
    test: (q) =>
      /\b(over time|time series|timeseries|trend(ing)?|temporal|by (day|week|month|year)|as a series|line chart)\b/.test(q),
    hit: { kind: "line", label: "Chart as Line", hint: "Trend · time series", score: 48 },
  },
  {
    test: (q) => /\b(rolling (mean|average)|moving average|7 ?day|30 ?day)\b/.test(q),
    hit: {
      kind: "line",
      label: "Line with rolling average",
      hint: "Smoothed trend",
      score: 46,
      extras: { rollingWindow: 7 },
    },
  },
  {
    test: (q) => /\b(area chart|filled trend|volume over time)\b/.test(q),
    hit: { kind: "area", label: "Chart as Area", hint: "Filled trend", score: 44 },
  },

  // Compare categories
  {
    test: (q) =>
      /\b(compare|comparison|by category|by group|ranking|rank|top \d+|bar chart|column chart)\b/.test(q) &&
      !/\b(over time|time series|map|geo)\b/.test(q),
    hit: { kind: "bar", label: "Chart as Bar", hint: "Compare categories", score: 45 },
  },
  {
    test: (q) => /\b(top\s*(\d+)|pareto|80\/?20|vital few)\b/.test(q),
    hit: {
      kind: "pareto",
      label: "Chart as Pareto",
      hint: "Ranked cumulative · 80/20",
      score: 47,
      extras: { topN: 20 },
    },
  },
  {
    test: (q) => /\b(lollipop)\b/.test(q),
    hit: { kind: "lollipop", label: "Chart as Lollipop", hint: "Sparse ranking", score: 44 },
  },
  {
    test: (q) => /\b(before and after|dumbbell|gap between)\b/.test(q),
    hit: { kind: "dumbbell", label: "Chart as Dumbbell", hint: "Paired before/after", score: 45 },
  },

  // Composition
  {
    test: (q) =>
      /\b(share of|part.?to.?whole|composition|breakdown|percentage of|donut|pie chart|mix of)\b/.test(q),
    hit: { kind: "pie", label: "Chart as Pie", hint: "Share · part-to-whole", score: 46 },
  },
  {
    test: (q) =>
      /\b(100\b.*\bstacked|percent stacked|stacked percent|composition over|fully stacked)\b/.test(q) ||
      /\bstacked\b.*\b(percent|percentage|100)\b/.test(q),
    hit: {
      kind: "bar",
      label: "100% stacked bars",
      hint: "Composition across groups",
      score: 47,
      extras: { barStackMode: "percent" },
    },
  },
  {
    test: (q) => /\b(stacked bars?|stack the)\b/.test(q),
    hit: {
      kind: "bar",
      label: "Stacked bars",
      hint: "Segments in each category",
      score: 44,
      extras: { barStackMode: "stacked" },
    },
  },
  {
    test: (q) => /\b(treemap|nested rectangles)\b/.test(q),
    hit: { kind: "treemap", label: "Chart as Treemap", hint: "Hierarchical parts", score: 44 },
  },
  {
    test: (q) => /\b(sunburst|radial hierarchy)\b/.test(q),
    hit: { kind: "sunburst", label: "Chart as Sunburst", hint: "Rings of hierarchy", score: 44 },
  },
  {
    test: (q) => /\b(waterfall|bridge chart|running total)\b/.test(q),
    hit: { kind: "waterfall", label: "Chart as Waterfall", hint: "Incremental contributions", score: 45 },
  },
  {
    test: (q) => /\b(funnel|conversion|drop.?off|pipeline stages)\b/.test(q),
    hit: { kind: "funnel", label: "Chart as Funnel", hint: "Stage drop-off", score: 45 },
  },

  // Density / heat
  {
    test: (q) => /\b(heatmap|heat map|intensity grid|matrix of)\b/.test(q) && !/\bcorr/.test(q),
    hit: { kind: "heatmap", label: "Chart as Heatmap", hint: "Grid intensity", score: 45 },
  },
  {
    test: (q) => /\b(hexbin|overplotting|dense scatter)\b/.test(q),
    hit: { kind: "hexbin", label: "Chart as Hexbin", hint: "Binned density", score: 44 },
  },

  // Geo / flow / network
  {
    test: (q) => /\b(map|geo|geographic|choropleth|by (state|country|county|region)|spatial)\b/.test(q),
    hit: { kind: "choropleth", label: "Chart as Choropleth map", hint: "Shaded regions", score: 47 },
  },
  {
    test: (q) => /\b(sankey|flow from|alluvial|migration flow)\b/.test(q),
    hit: { kind: "sankey", label: "Chart as Sankey", hint: "Flows between nodes", score: 46 },
  },
  {
    test: (q) => /\b(network|graph of|force.?directed|nodes and edges)\b/.test(q),
    hit: { kind: "network", label: "Chart as Network", hint: "Links · nodes", score: 45 },
  },

  // Scale / anomaly / aggregate language
  {
    test: (q) => /\b(log scale|logarithmic|log y|orders of magnitude)\b/.test(q),
    hit: {
      kind: "bar",
      label: "Chart with log Y",
      hint: "Orders of magnitude",
      score: 43,
      extras: { yScale: "log" },
    },
  },
  {
    test: (q) => /\b(anomal(y|ies)|outlier|weird points|highlight outliers)\b/.test(q),
    hit: {
      kind: "scatter",
      label: "Highlight anomalies",
      hint: "Ring unusual points",
      score: 44,
      extras: { anomalyHighlight: true },
    },
  },
  {
    test: (q) => /\b(average|mean of|avg )\b/.test(q) && /\b(by|per|group)\b/.test(q),
    hit: {
      kind: "bar",
      label: "Bar of averages",
      hint: "Mean by category",
      score: 42,
      extras: { yAggregate: "mean" },
    },
  },
  {
    test: (q) => /\b(sum of|total by|totals by)\b/.test(q),
    hit: {
      kind: "bar",
      label: "Bar of totals",
      hint: "Sum by category",
      score: 42,
      extras: { yAggregate: "sum" },
    },
  },
  {
    test: (q) => /\b(count of|how many rows|frequency by)\b/.test(q) && !/\bask\b/.test(q),
    hit: {
      kind: "bar",
      label: "Bar of counts",
      hint: "Row counts by category",
      score: 41,
      extras: { yAggregate: "count" },
    },
  },

  // Looks — how the chart should *feel*
  {
    test: (q) => /\b(tufte|minimal|data.?ink|no chartjunk|spare)\b/.test(q),
    hit: { look: "tufte", label: "Look: Tufte", hint: "Max data-ink · quiet axes", score: 40 },
  },
  {
    test: (q) => /\b(clarity|clean look|readable|presentation)\b/.test(q),
    hit: { look: "clarity", label: "Look: Clarity", hint: "Presentation-ready", score: 39 },
  },
  {
    test: (q) => /\b(bauhaus|bold geometry|flat color)\b/.test(q),
    hit: { look: "bauhaus", label: "Look: Bauhaus", hint: "Bold rails · blocks", score: 39 },
  },
  {
    test: (q) => /\b(newspaper|broadsheet|editorial)\b/.test(q),
    hit: { look: "newspaper", label: "Look: Newspaper", hint: "Editorial print feel", score: 38 },
  },
  {
    test: (q) => /\b(high.?contrast|accessible contrast)\b/.test(q),
    hit: { look: "high-contrast", label: "Look: High contrast", hint: "Stronger separation", score: 38 },
  },
  {
    test: (q) => /\b(glass look|frosted|glassy)\b/.test(q),
    hit: { look: "glass", label: "Look: Glass", hint: "Frosted chrome", score: 37 },
  },
  {
    test: (q) => /\b(terminal|crt|hacker aesthetic)\b/.test(q),
    hit: { look: "terminal", label: "Look: Terminal", hint: "CRT / mono vibe", score: 37 },
  },

  // Chrome / analysis surfaces
  {
    test: (q) => /\b(encoding|encodings|map fields|assign axes|x and y)\b/.test(q),
    hit: { action: "encoding", label: "Open Encoding", hint: "Chart → field mapping", score: 41 },
  },
  {
    test: (q) => /\b(stats|statistics|summary stats|describe the data)\b/.test(q),
    hit: { action: "panel:stats", label: "Open Stats", hint: "Column summaries", score: 40 },
  },
  {
    test: (q) => /\b(clear filters?|reset filters?|remove filters?)\b/.test(q),
    hit: { action: "clear-filters", label: "Clear table filters", hint: "Full sample again", score: 42 },
  },
  {
    test: (q) => /\b(reset view|reset the view|clear view|start over)\b/.test(q),
    hit: { action: "reset-view", label: "Reset view", hint: "Filters · sort · brush · time", score: 44 },
  },
  {
    test: (q) => /\b(deep ?scan|scan for charts|suggest charts|what charts)\b/.test(q),
    hit: { action: "deep-scan", label: "Deep scan for charts", hint: "Swipe Keep / Skip deck", score: 43 },
  },
  {
    test: (q) => /\b(export (png|svg|image)|download (chart|image))\b/.test(q),
    hit: { action: "panel:export", label: "Open Export", hint: "PNG · SVG · social", score: 40 },
  },
  {
    test: (q) => /\b(explain|describe|profile|what is|tell me about)\b/.test(q),
    hit: {
      action: "explain-column",
      label: "Explain column",
      hint: "Open Stats for a named field",
      score: 43,
    },
  },
  {
    test: (q) => /\b(color by|colour by|lock color|keep color)\b/.test(q),
    hit: {
      action: "lock-color",
      label: "Lock color field",
      hint: "Survives chart-type switches",
      score: 45,
    },
  },
];

/** Best-effort: column names mentioned in free text (longest first; skip nested shorts). */
export function extractMentionedColumns(query: string, columns: string[]): string[] {
  const q = normalize(query);
  if (!q || !columns.length) return [];

  // “a vs b” / “a versus b” — preserve left→right order for scatter encodings
  const vs = q.match(/^(.+?)\s+(?:vs\.?|versus)\s+(.+)$/);
  if (vs) {
    const left = vs[1]!.trim();
    const right = vs[2]!.trim();
    const findCol = (side: string) =>
      columns.find((c) => {
        const t = normalize(c);
        return side === t || side.includes(t) || t.includes(side) || side === t.replace(/_/g, " ");
      });
    const a = findCol(left);
    const b = findCol(right);
    if (a && b && a !== b) return [a, b];
  }

  const ranked = [...columns].sort((a, b) => b.length - a.length);
  const hits: string[] = [];
  for (const col of ranked) {
    const token = normalize(col);
    if (token.length < 2) continue;
    if (!(q.includes(token) || q.includes(token.replace(/_/g, " ")))) continue;
    // Skip if this column is a substring of an already-chosen longer name
    if (hits.some((h) => normalize(h).includes(token))) continue;
    hits.push(col);
    if (hits.length >= 3) break;
  }
  return hits;
}

/**
 * Resolve analyst / layman / bot-style phrases into ranked Loom intents.
 * Does not open anything — command palette runs the hits.
 */
export function resolveAnalysisVernacular(
  raw: string,
  opts?: { columns?: string[] },
): VernacularHit[] {
  const stripped = stripTalkFiller(raw);
  const q = normalize(stripped);
  if (!q) return [];

  const fields = extractMentionedColumns(raw, opts?.columns ?? []);
  const out: VernacularHit[] = [];

  for (const rule of INTENT_RULES) {
    if (!rule.test(q)) continue;
    out.push({ ...rule.hit, fields: fields.length ? fields : undefined });
  }

  // “X vs Y” with two column names → scatter preference
  if (fields.length >= 2 && !out.some((h) => h.kind === "scatter")) {
    out.push({
      kind: "scatter",
      label: `Scatter ${fields[0]} vs ${fields[1]}`,
      hint: "Relationship from named fields",
      score: 50,
      fields,
    });
  } else if (fields.length === 1 && out.length) {
    // Annotate top chart hit with the field name
    const top = out.find((h) => h.kind);
    if (top && !top.label.includes(fields[0]!)) {
      top.label = `${top.label} · ${fields[0]}`;
      top.fields = fields;
    }
  }

  return out.sort((a, b) => b.score - a.score);
}

/** True when query is analysis talk (skip open-data catalog spam). */
export function looksLikeAnalysisTalk(query: string): boolean {
  const q = normalize(stripTalkFiller(query));
  if (q.length < 3) return false;
  if (INTENT_RULES.some((r) => r.test(q))) return true;
  if (/\b(chart|plot|graph|histogram|scatter|heatmap|map it|visualize|visualise)\b/.test(q)) return true;
  return false;
}
