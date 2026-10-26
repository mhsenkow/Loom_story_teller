// =================================================================
// Chart kind / recommendation types shared by every recs module.
// (split from recommendations.ts — LOOM-195; public API re-exported there)
// =================================================================

import { GEO_MAP_KIND_OPTIONS, type GeoMapKind } from "../geoMapsRec";
import { GPU_SCENE_KIND_OPTIONS, type GpuSceneKind } from "../gpuScenesRec";
import { ODD_CHART_KIND_OPTIONS, type OddChartKind } from "../oddChartsRec";

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
  | "network"
  | "arcDiagram"
  | "pareto"
  | "corrMatrix"
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
  { value: "network", label: "Network" },
  { value: "arcDiagram", label: "Arc diagram" },
  { value: "pareto", label: "Pareto" },
  { value: "corrMatrix", label: "Correlation matrix" },
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
  /** Optional row facet / small multiples (bar, line, area, scatter). */
  rowField?: string | null;
  /** Optional glow encoding (scatter): column drives glow on/off or intensity. */
  glowField?: string | null;
  /** Optional outline encoding (scatter): column drives stroke on/off or width. */
  outlineField?: string | null;
  /** Optional opacity encoding (scatter, strip): column drives per-point opacity. */
  opacityField?: string | null;
  /** Optional nominal field that cycles point shapes by category. */
  shapeField?: string | null;
  /** Optional field whose first grapheme is drawn as each point's emoji. */
  emojiField?: string | null;
  /** Semantic emoji for codes/categories, bound to its original column. */
  emojiMap?: import("../chartEmoji").ChartEmojiMap | null;
  /** Aggregation for Y (or theta) when chart type uses it: bar, line, area, pie. */
  yAggregate?: YAggregateOption | null;
  /** Cap categories by value rank (bar and similar). Null = default. */
  topN?: number | null;
  /**
   * Chunk color and shape into this many groups. Numbers become ranges;
   * categories keep the largest and roll the rest into Other. Null = each value.
   */
  groupInto?: number | null;
  /** Second numeric measure drawn as a dashed overlay (line / area). */
  y2Field?: string | null;
  /** Overlay the earlier half of a time series as “previous” (line / area). */
  comparePrevious?: boolean | null;
  /** Bar + Color: grouped (dodge), stacked, or 100% stacked. */
  barStackMode?: "grouped" | "stacked" | "percent" | null;
  /** Rolling mean window on line / area (points along X). */
  rollingWindow?: 7 | 30 | null;
  /** Y axis scale for magnitude charts. */
  yScale?: "linear" | "log" | "symlog" | null;
  /** Rebase multi-series line/area for fair compare. */
  seriesNormalize?: "index100" | "zscore" | null;
  /** Scatter: draw residual stems vs linear fit. */
  residualOverlay?: boolean | null;
  /** Scatter/line: ring z-score outlier rows on the measure. */
  anomalyHighlight?: boolean | null;
  /** Bump: plot Δrank instead of absolute rank. */
  bumpMode?: "rank" | "delta" | null;
  /** Word cloud: one spiral, a two-sided comparison, or one cloud per group. */
  wordCloudMode?: "cloud" | "compare" | "grid" | null;
  /** Pyramid: shared / independent / auto arm scales. */
  pyramidScaleMode?: "auto" | "shared" | "independent" | null;
  /** Dual-measure / compare: show signed Δ or % change on marks. */
  deltaDisplay?: "off" | "diff" | "pct" | null;
  /** Timestamp column used to slice rows (independent of X). */
  timeWindowField?: string | null;
  /** Keep rows in this window, counted back from the newest value. */
  timeWindow?: "all" | "1h" | "6h" | "24h" | "7d" | "30d" | "90d" | "1y" | null;
  /** Explicit tooltip column names; when unset, encoding fields are used. */
  tooltipFields?: string[] | null;
  /** Identity column for cross-chart tooltip link / lock (L key). */
  tooltipKeyField?: string | null;
  /** Bar-like layout: measure grows up / down / left / right (null = auto). */
  layoutDirection?: "auto" | "up" | "down" | "right" | "left" | null;
  /** High values draw as the low end of size, color, opacity, glow, outline, or depth. */
  channelInvert?: import("../channelInvert").ChannelInvert | null;
}
